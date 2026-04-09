import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { JiraService } from '../jira-service.js';
import { createJiraServer } from '../server-factory.js';

jest.mock('../jira-client/index.js', () => ({
  IssueService: {
    getIssue: jest.fn(),
    createIssue: jest.fn(),
    updateIssue: jest.fn(),
    getComments: jest.fn(),
    addComment: jest.fn(),
    getTransitions: jest.fn(),
    doTransition: jest.fn(),
  },
  SearchService: {
    searchUsingSearchRequest: jest.fn(),
  },
  OpenAPI: { BASE: '', TOKEN: '', VERSION: '' },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IssueService, SearchService } = require('../jira-client/index.js') as {
  IssueService: Record<string, jest.Mock>;
  SearchService: Record<string, jest.Mock>;
};

async function buildClient(service: JiraService) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createJiraServer(service);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

function makeService(excludedProjects: string[] = []) {
  return new JiraService('test-host', 'test-token', undefined, () => 25, () => excludedProjects);
}

describe('Jira MCP server — integration', () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof buildClient>>['server'];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  describe('tool listing', () => {
    it('registers all 8 Jira tools', async () => {
      ({ client, server } = await buildClient(makeService()));
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name);
      expect(names).toEqual(expect.arrayContaining([
        'jira_searchIssues',
        'jira_getIssue',
        'jira_getIssueComments',
        'jira_createIssue',
        'jira_updateIssue',
        'jira_postIssueComment',
        'jira_getTransitions',
        'jira_transitionIssue',
      ]));
      expect(tools).toHaveLength(8);
    });
  });

  describe('Zod schema validation at MCP boundary', () => {
    it('rejects jira_searchIssues when required jql argument is missing', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({ name: 'jira_searchIssues', arguments: {} });
      expect(result.isError).toBe(true);
      expect(SearchService.searchUsingSearchRequest).not.toHaveBeenCalled();
    });

    it('rejects jira_searchIssues when jql exceeds max length', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({
        name: 'jira_searchIssues',
        arguments: { jql: 'x'.repeat(10001) },
      });
      expect(result.isError).toBe(true);
      expect(SearchService.searchUsingSearchRequest).not.toHaveBeenCalled();
    });

    it('rejects jira_getIssue when issueKey exceeds max length', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({
        name: 'jira_getIssue',
        arguments: { issueKey: 'A'.repeat(51) },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('exclusion enforcement through MCP boundary', () => {
    it('blocks jira_getIssue for an excluded project without calling the API', async () => {
      ({ client, server } = await buildClient(makeService(['SECRET'])));
      IssueService.getIssue.mockResolvedValue({});

      const result = await client.callTool({
        name: 'jira_getIssue',
        arguments: { issueKey: 'SECRET-42' },
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/SECRET.*excluded/i);
      expect(IssueService.getIssue).not.toHaveBeenCalled();
    });

    it('blocks jira_getIssueComments for an excluded project', async () => {
      ({ client, server } = await buildClient(makeService(['LOCKED'])));
      IssueService.getComments.mockResolvedValue({});

      const result = await client.callTool({
        name: 'jira_getIssueComments',
        arguments: { issueKey: 'LOCKED-1' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(IssueService.getComments).not.toHaveBeenCalled();
    });

    it('injects NOT IN clause into jql for jira_searchIssues — does not block the search', async () => {
      ({ client, server } = await buildClient(makeService(['EXCL'])));
      SearchService.searchUsingSearchRequest.mockResolvedValue({ issues: [], total: 0 });

      await client.callTool({
        name: 'jira_searchIssues',
        arguments: { jql: 'project = TEST' },
      });

      expect(SearchService.searchUsingSearchRequest).toHaveBeenCalledTimes(1);
      const calledJql = SearchService.searchUsingSearchRequest.mock.calls[0][0].jql as string;
      expect(calledJql).toMatch(/project NOT IN/i);
      expect(calledJql).toMatch(/"EXCL"/);
    });

    it('allows access to non-excluded project', async () => {
      ({ client, server } = await buildClient(makeService(['SECRET'])));
      IssueService.getIssue.mockResolvedValue({ key: 'OPEN-1', fields: {} });

      const result = await client.callTool({
        name: 'jira_getIssue',
        arguments: { issueKey: 'OPEN-1' },
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(true);
      expect(IssueService.getIssue).toHaveBeenCalled();
    });
  });
});
