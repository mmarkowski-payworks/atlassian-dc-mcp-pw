import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BitbucketService } from '../bitbucket-service.js';
import { createBitbucketServer } from '../server-factory.js';

jest.mock('../bitbucket-client/index.js', () => ({
  PullRequestsService: {
    getPage: jest.fn(),
    get3: jest.fn(),
    getActivities: jest.fn(),
    streamChanges1: jest.fn(),
    createComment2: jest.fn(),
    updateStatus: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    getReviewers: jest.fn(),
  },
  ProjectService: {
    getProjects: jest.fn(),
    getProject: jest.fn(),
    getRepositories: jest.fn(),
    getRepository: jest.fn(),
  },
  OpenAPI: { BASE: '', TOKEN: '', VERSION: '' },
}));

jest.mock('../bitbucket-client/core/request.js', () => ({
  request: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProjectService } = require('../bitbucket-client/index.js') as {
  ProjectService: Record<string, jest.Mock>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PullRequestsService } = require('../bitbucket-client/index.js') as {
  PullRequestsService: Record<string, jest.Mock>;
};

async function buildClient(service: BitbucketService) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBitbucketServer(service);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

function makeService(excludedRepos: string[] = []) {
  return new BitbucketService('test-host', 'test-token', undefined, () => 25, () => excludedRepos);
}

describe('Bitbucket MCP server — integration', () => {
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
    it('registers all 18 Bitbucket tools', async () => {
      ({ client, server } = await buildClient(makeService()));
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name);
      expect(names).toEqual(expect.arrayContaining([
        'bitbucket_getProjects',
        'bitbucket_getProject',
        'bitbucket_getRepositories',
        'bitbucket_getRepository',
        'bitbucket_getCommits',
        'bitbucket_getPullRequests',
        'bitbucket_getPullRequest',
        'bitbucket_getPR_CommentsAndAction',
        'bitbucket_getPullRequestChanges',
        'bitbucket_getUser',
        'bitbucket_postPullRequestComment',
        'bitbucket_submitPullRequestReview',
        'bitbucket_getPullRequestDiff',
        'bitbucket_createPullRequest',
        'bitbucket_updatePullRequest',
        'bitbucket_getRequiredReviewers',
        'bitbucket_getInboxPullRequests',
        'bitbucket_getDashboardPullRequests',
      ]));
      expect(tools).toHaveLength(18);
    });
  });

  describe('Zod schema validation at MCP boundary', () => {
    it('rejects bitbucket_getPullRequests when repositorySlug is missing', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({
        name: 'bitbucket_getPullRequests',
        arguments: { projectKey: 'PROJ' },
      });
      expect(result.isError).toBe(true);
      expect(PullRequestsService.getPage).not.toHaveBeenCalled();
    });

    it('rejects bitbucket_getRepository when projectKey is missing', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({
        name: 'bitbucket_getRepository',
        arguments: { repositorySlug: 'my-repo' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('exclusion enforcement through MCP boundary', () => {
    it('blocks bitbucket_getRepository for an excluded repo without calling the API', async () => {
      ({ client, server } = await buildClient(makeService(['MYPROJ/secret-repo'])));
      ProjectService.getRepository.mockResolvedValue({});

      const result = await client.callTool({
        name: 'bitbucket_getRepository',
        arguments: { projectKey: 'MYPROJ', repositorySlug: 'secret-repo' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/MYPROJ\/secret-repo.*excluded/i);
      expect(ProjectService.getRepository).not.toHaveBeenCalled();
    });

    it('blocks bitbucket_getPullRequests for an excluded repo', async () => {
      ({ client, server } = await buildClient(makeService(['PROJ/locked-repo'])));

      const result = await client.callTool({
        name: 'bitbucket_getPullRequests',
        arguments: { projectKey: 'PROJ', repositorySlug: 'locked-repo' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/excluded/i);
      expect(PullRequestsService.getPage).not.toHaveBeenCalled();
    });

    it('blocks bitbucket_createPullRequest for an excluded repo', async () => {
      ({ client, server } = await buildClient(makeService(['MYPROJ/locked-repo'])));

      const result = await client.callTool({
        name: 'bitbucket_createPullRequest',
        arguments: {
          projectKey: 'MYPROJ',
          repositorySlug: 'locked-repo',
          title: 'My PR',
          fromRefId: 'refs/heads/feature',
          toRefId: 'refs/heads/main',
        },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(PullRequestsService.create).not.toHaveBeenCalled();
    });

    it('silently filters excluded repos out of bitbucket_getRepositories response', async () => {
      ProjectService.getRepositories.mockResolvedValue({
        values: [{ slug: 'open-repo' }, { slug: 'secret-repo' }],
        isLastPage: true,
      });
      ({ client, server } = await buildClient(makeService(['PROJ/secret-repo'])));

      const result = await client.callTool({
        name: 'bitbucket_getRepositories',
        arguments: { projectKey: 'PROJ' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(true);
      const slugs = (payload.data.values as Array<{ slug: string }>).map(r => r.slug);
      expect(slugs).toEqual(['open-repo']);
      expect(slugs).not.toContain('secret-repo');
    });

    it('allows access to a non-excluded repo', async () => {
      ProjectService.getRepository.mockResolvedValue({ slug: 'open-repo', project: { key: 'PROJ' } });
      ({ client, server } = await buildClient(makeService(['PROJ/secret-repo'])));

      const result = await client.callTool({
        name: 'bitbucket_getRepository',
        arguments: { projectKey: 'PROJ', repositorySlug: 'open-repo' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(true);
      expect(ProjectService.getRepository).toHaveBeenCalled();
    });
  });
});
