import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ConfluenceService } from '../confluence-service.js';
import { createConfluenceServer } from '../server-factory.js';

jest.mock('../confluence-client/index.js', () => ({
  ContentResourceService: {
    getContentById: jest.fn(),
    createContent: jest.fn(),
    updateContent: jest.fn(),
  },
  SearchService: {
    search1: jest.fn(),
    getSpaces: jest.fn(),
  },
  OpenAPI: { BASE: '', TOKEN: '', VERSION: '' },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ContentResourceService, SearchService } = require('../confluence-client/index.js') as {
  ContentResourceService: Record<string, jest.Mock>;
  SearchService: Record<string, jest.Mock>;
};

async function buildClient(service: ConfluenceService) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createConfluenceServer(service);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

function makeService(excludedSpaces: string[] = []) {
  return new ConfluenceService('test-host', 'test-token', undefined, () => 25, () => excludedSpaces);
}

describe('Confluence MCP server — integration', () => {
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
    it('registers all 5 Confluence tools', async () => {
      ({ client, server } = await buildClient(makeService()));
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name);
      expect(names).toEqual(expect.arrayContaining([
        'confluence_getContent',
        'confluence_searchContent',
        'confluence_createContent',
        'confluence_updateContent',
        'confluence_searchSpace',
      ]));
      expect(tools).toHaveLength(5);
    });
  });

  describe('Zod schema validation at MCP boundary', () => {
    it('rejects confluence_searchContent when required cql argument is missing', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({ name: 'confluence_searchContent', arguments: {} });
      expect(result.isError).toBe(true);
    });

    it('rejects confluence_createContent when content exceeds max length', async () => {
      ({ client, server } = await buildClient(makeService()));
      const result = await client.callTool({
        name: 'confluence_createContent',
        arguments: { title: 'T', spaceKey: 'PROJ', content: 'x'.repeat(1_000_001) },
      });
      expect(result.isError).toBe(true);
      expect(ContentResourceService.createContent).not.toHaveBeenCalled();
    });
  });

  describe('exclusion enforcement through MCP boundary', () => {
    it('blocks confluence_getContent when content belongs to an excluded space', async () => {
      ContentResourceService.getContentById.mockResolvedValue({
        id: '1', title: 'Page',
        space: { key: 'PRIVATE' },
        body: { storage: { value: '<p>secret</p>' } },
      });
      ({ client, server } = await buildClient(makeService(['PRIVATE'])));

      const result = await client.callTool({
        name: 'confluence_getContent',
        arguments: { contentId: '1' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/PRIVATE.*excluded/i);
    });

    it('blocks confluence_createContent for an excluded space without calling the API', async () => {
      ({ client, server } = await buildClient(makeService(['LOCKED'])));

      const result = await client.callTool({
        name: 'confluence_createContent',
        arguments: { title: 'New Page', spaceKey: 'LOCKED', content: '<p>hi</p>' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/LOCKED.*excluded/i);
      expect(ContentResourceService.createContent).not.toHaveBeenCalled();
    });

    it('blocks confluence_updateContent after reading the content space — pre-write guard fires', async () => {
      ContentResourceService.getContentById.mockResolvedValue({
        type: 'page', title: 'Old Title',
        space: { key: 'GUARDED' },
        body: { storage: { value: '' } },
      });
      ({ client, server } = await buildClient(makeService(['GUARDED'])));

      const result = await client.callTool({
        name: 'confluence_updateContent',
        arguments: { contentId: '99', version: 2 },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toMatch(/GUARDED.*excluded/i);
      // Page was read (getContentById) but update was never called
      expect(ContentResourceService.getContentById).toHaveBeenCalledWith('99', expect.any(String));
      expect(ContentResourceService.updateContent).not.toHaveBeenCalled();
    });

    it('injects NOT IN clause into CQL for confluence_searchContent', async () => {
      SearchService.search1.mockResolvedValue({ results: [], totalSize: 0 });
      ({ client, server } = await buildClient(makeService(['HR'])));

      await client.callTool({
        name: 'confluence_searchContent',
        arguments: { cql: 'type = page' },
      });

      // The service appends the space exclusion before calling SearchService.search1
      expect(SearchService.search1).toHaveBeenCalledTimes(1);
      // search1 receives: (cqlContext, expand, includeArchivedSpaces, excerpt, start, limit, cql)
      const args = SearchService.search1.mock.calls[0] as unknown[];
      const calledCql = args.find(a => typeof a === 'string' && a.includes('type = page')) as string;
      expect(calledCql).toMatch(/space\.key NOT IN/i);
      expect(calledCql).toMatch(/"HR"/);
    });

    it('allows access to non-excluded space', async () => {
      ContentResourceService.getContentById.mockResolvedValue({
        id: '5', title: 'Public Page',
        space: { key: 'PUBLIC' },
        body: { storage: { value: '<p>ok</p>' } },
      });
      ({ client, server } = await buildClient(makeService(['PRIVATE'])));

      const result = await client.callTool({
        name: 'confluence_getContent',
        arguments: { contentId: '5' },
      });

      const payload = JSON.parse(((result as { content: Array<{ text: string }> }).content[0]).text);
      expect(payload.success).toBe(true);
    });
  });
});
