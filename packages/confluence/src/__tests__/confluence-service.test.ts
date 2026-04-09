import { ConfluenceService, escapeSearchTextForCql } from '../confluence-service.js';
import { ContentResourceService, SearchService } from '../confluence-client/index.js';

jest.mock('../confluence-client/index.js', () => ({
  ContentResourceService: {
    getContentById: jest.fn(),
    createContent: jest.fn(),
    update2: jest.fn(),
  },
  SearchService: {
    search1: jest.fn(),
  },
  OpenAPI: {
    BASE: '',
    TOKEN: '',
    VERSION: '',
  },
}));

describe('escapeSearchTextForCql', () => {
  it('returns plain text unchanged', () => {
    expect(escapeSearchTextForCql('hello')).toBe('hello');
    expect(escapeSearchTextForCql('space name')).toBe('space name');
  });

  it('escapes double quotes', () => {
    expect(escapeSearchTextForCql('say "hello"')).toBe('say \\"hello\\"');
  });

  it('escapes backslashes first so they cannot escape the following quote', () => {
    expect(escapeSearchTextForCql('\\')).toBe('\\\\');
    expect(escapeSearchTextForCql('path\\to\\space')).toBe('path\\\\to\\\\space');
  });

  it('escapes backslash then quote correctly (order matters)', () => {
    expect(escapeSearchTextForCql('\\"')).toBe('\\\\\\"');
  });

  it('escapes quote then backslash correctly', () => {
    expect(escapeSearchTextForCql('"\\')).toBe('\\"\\\\');
  });

  it('prevents CQL injection via quoted phrase breakout', () => {
    const malicious = '" OR type=page AND text ~ "secret';
    const escaped = escapeSearchTextForCql(malicious);
    expect(escaped).toContain('\\"');
    expect(escaped).not.toBe(malicious);
  });

  it('double-escaping is not idempotent (call once only)', () => {
    const input = 'foo"bar\\baz';
    const once = escapeSearchTextForCql(input);
    const twice = escapeSearchTextForCql(once);
    expect(twice).not.toBe(once);
    expect(twice).toContain('\\\\');
  });

  it('handles empty string', () => {
    expect(escapeSearchTextForCql('')).toBe('');
  });
});

describe('ConfluenceService.searchSpaces', () => {
  let service: ConfluenceService;

  beforeEach(() => {
    service = new ConfluenceService('test-host', 'test-token');
    jest.clearAllMocks();
  });

  it('builds CQL with escaped searchText and calls SearchService', async () => {
    (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });

    await service.searchSpaces('my space', 10, 0);

    expect(SearchService.search1).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      '10',
      '0',
      'none',
      'type=space AND title ~ "my space"'
    );
  });

  it('escapes quotes in searchText in the CQL passed to the API', async () => {
    (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });

    await service.searchSpaces('say "hello"', 5);

    expect(SearchService.search1).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      '5',
      undefined,
      'none',
      'type=space AND title ~ "say \\"hello\\""'
    );
  });

  it('escapes backslashes in searchText in the CQL passed to the API', async () => {
    (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });

    await service.searchSpaces('path\\to\\space', 5);

    expect(SearchService.search1).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      '5',
      undefined,
      'none',
      'type=space AND title ~ "path\\\\to\\\\space"'
    );
  });

  it('forwards API errors via handleApiOperation', async () => {
    const err = new Error('API error');
    (SearchService.search1 as jest.Mock).mockRejectedValue(err);

    const result = await service.searchSpaces('test');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('ConfluenceService token optimization paths', () => {
  let service: ConfluenceService;

  beforeEach(() => {
    service = new ConfluenceService('test-host', 'test-token');
    jest.clearAllMocks();
  });

  it('keeps storage mode as the default body shape', async () => {
    const mockContent = {
      id: '123',
      type: 'page',
      title: 'Test page',
      body: {
        storage: {
          value: '<p>Hello</p>',
          representation: 'storage',
        },
      },
    };
    (ContentResourceService.getContentById as jest.Mock).mockResolvedValue(mockContent);

    const result = await service.getContent('123');

    expect(result.success).toBe(true);
    expect(result.data).toBe(mockContent);
    expect(ContentResourceService.getContentById).toHaveBeenCalledWith('123', 'body.storage');
  });

  it('converts storage XML to text when bodyMode is text', async () => {
    (ContentResourceService.getContentById as jest.Mock).mockResolvedValue({
      id: '123',
      type: 'page',
      title: 'Test page',
      body: {
        storage: {
          value: '<p>Hello &amp; <strong>world</strong></p><ul><li>One</li><li>Two</li></ul>',
          representation: 'storage',
        },
      },
      version: { number: 3 },
    });

    const result = await service.getContent('123', 'version', 'text');

    expect(result.success).toBe(true);
    expect(ContentResourceService.getContentById).toHaveBeenCalledWith('123', 'version,body.storage');
    expect(result.data).toMatchObject({
      id: '123',
      type: 'page',
      title: 'Test page',
      version: { number: 3 },
      body: {
        text: {
          representation: 'text',
        },
      },
    });
    expect((result.data as any).body.text.value).toContain('Hello & world');
    expect((result.data as any).body.text.value).toContain('- One');
    expect((result.data as any).body.text.value).toContain('- Two');
  });

  it('truncates text bodies when maxBodyChars is provided', async () => {
    (ContentResourceService.getContentById as jest.Mock).mockResolvedValue({
      id: '123',
      type: 'page',
      title: 'Test page',
      body: {
        storage: {
          value: '<p>Hello world</p>',
          representation: 'storage',
        },
      },
    });

    const result = await service.getContent('123', undefined, 'text', 5);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: '123',
      type: 'page',
      title: 'Test page',
      body: {
        text: {
          value: 'Hello',
          representation: 'text',
          truncated: true,
          originalLength: 11,
        },
      },
    });
  });

  it('omits the body when bodyMode is none', async () => {
    (ContentResourceService.getContentById as jest.Mock).mockResolvedValue({
      id: '123',
      type: 'page',
      title: 'Test page',
      body: {
        storage: {
          value: '<p>Hello</p>',
          representation: 'storage',
        },
      },
      version: { number: 1 },
    });

    const result = await service.getContent('123', undefined, 'none');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: '123',
      type: 'page',
      title: 'Test page',
      version: { number: 1 },
    });
  });

  it('uses the package default limit and no excerpt for content search', async () => {
    (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });

    await service.searchContent('type=page');

    expect(SearchService.search1).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      '25',
      undefined,
      'none',
      'type=page'
    );
  });

  it('forwards explicit excerpt for space search', async () => {
    (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });

    await service.searchSpaces('docs', 5, 10, 'space.icon', 'highlight');

    expect(SearchService.search1).toHaveBeenCalledWith(
      undefined,
      'space.icon',
      undefined,
      '5',
      '10',
      'highlight',
      'type=space AND title ~ "docs"'
    );
  });
});

describe('ConfluenceService space exclusions', () => {
  const makeService = (excluded: string[]) =>
    new ConfluenceService('host', 'token', undefined, () => 25, () => excluded);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchContent — CQL injection', () => {
    it('injects NOT IN clause for a single excluded space', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['EXCL']).searchContent('type=page');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        '(type=page) AND space.key NOT IN ("EXCL")'
      );
    });

    it('injects NOT IN clause for multiple excluded spaces', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['EXCL', 'ARCHIVE', 'LEGACY']).searchContent('type=page');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        '(type=page) AND space.key NOT IN ("EXCL", "ARCHIVE", "LEGACY")'
      );
    });

    it('preserves ORDER BY at the end of the modified CQL', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['EXCL']).searchContent('type=page ORDER BY created DESC');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        '(type=page) AND space.key NOT IN ("EXCL") ORDER BY created DESC'
      );
    });

    it('passes CQL unchanged when no spaces are excluded', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService([]).searchContent('type=page ORDER BY created DESC');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=page ORDER BY created DESC'
      );
    });

    it('calls API and returns results for a non-excluded search', async () => {
      const mockData = { results: [{ id: '1' }] };
      (SearchService.search1 as jest.Mock).mockResolvedValue(mockData);
      const result = await makeService(['EXCL']).searchContent('type=page AND space.key = ALLOWED');
      expect(result.success).toBe(true);
      expect(result.data).toBe(mockData);
      expect(SearchService.search1).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchSpaces — CQL injection', () => {
    it('appends exclusion clause to the generated space CQL', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['EXCL']).searchSpaces('my space');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=space AND title ~ "my space" AND space.key NOT IN ("EXCL")'
      );
    });

    it('appends multiple excluded spaces', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['EXCL', 'ARCHIVE']).searchSpaces('docs');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=space AND title ~ "docs" AND space.key NOT IN ("EXCL", "ARCHIVE")'
      );
    });

    it('does not append exclusion when list is empty', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService([]).searchSpaces('docs');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=space AND title ~ "docs"'
      );
    });
  });

  describe('CQL escaping of excluded space keys', () => {
    it('escapes double quotes in excluded space key in searchContent', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['SP"ACE']).searchContent('type=page');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        '(type=page) AND space.key NOT IN ("SP\\"ACE")'
      );
    });

    it('escapes backslashes in excluded space key in searchContent', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['SP\\ACE']).searchContent('type=page');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        '(type=page) AND space.key NOT IN ("SP\\\\ACE")'
      );
    });

    it('escapes double quotes in excluded space key in searchSpaces', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['SP"ACE']).searchSpaces('docs');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=space AND title ~ "docs" AND space.key NOT IN ("SP\\"ACE")'
      );
    });

    it('escapes backslashes in excluded space key in searchSpaces', async () => {
      (SearchService.search1 as jest.Mock).mockResolvedValue({ results: [] });
      await makeService(['SP\\ACE']).searchSpaces('docs');
      expect(SearchService.search1).toHaveBeenCalledWith(
        undefined, undefined, undefined, '25', undefined, 'none',
        'type=space AND title ~ "docs" AND space.key NOT IN ("SP\\\\ACE")'
      );
    });
  });

  describe('createContent', () => {
    it('blocks request and does not call API when space is excluded', async () => {
      const result = await makeService(['EXCL']).createContent({ type: 'page', title: 'T', space: { key: 'EXCL' } });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EXCL/);
      expect(result.error).toContain('excluded');
      expect(ContentResourceService.createContent).not.toHaveBeenCalled();
    });

    it('calls API with correct args when space is allowed', async () => {
      const payload = { type: 'page', title: 'T', space: { key: 'ALLOWED' }, body: { storage: { value: '<p/>', representation: 'storage' as const } } };
      (ContentResourceService.createContent as jest.Mock).mockResolvedValue({ id: '1', ...payload });
      const result = await makeService(['EXCL']).createContent(payload);
      expect(result.success).toBe(true);
      expect(ContentResourceService.createContent).toHaveBeenCalledWith(payload);
    });
  });

  describe('updateContent', () => {
    it('blocks request and does not call API when space is excluded', async () => {
      const result = await makeService(['EXCL']).updateContent('123', {
        type: 'page', title: 'T', space: { key: 'EXCL' }, version: { number: 2 },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EXCL/);
      expect(ContentResourceService.update2).not.toHaveBeenCalled();
    });

    it('calls API when space is allowed', async () => {
      const payload = { type: 'page', title: 'T', space: { key: 'ALLOWED' }, version: { number: 2 } };
      (ContentResourceService.update2 as jest.Mock).mockResolvedValue({ id: '123', ...payload });
      const result = await makeService(['EXCL']).updateContent('123', payload);
      expect(result.success).toBe(true);
      expect(ContentResourceService.update2).toHaveBeenCalledWith('123', payload);
    });
  });

  describe('isSpaceExcluded — public check for tool-handler use', () => {
    it('returns true when space key is in excluded list', () => {
      expect(makeService(['EXCL']).isSpaceExcluded('EXCL')).toBe(true);
    });

    it('returns true case-insensitively', () => {
      expect(makeService(['excl']).isSpaceExcluded('EXCL')).toBe(true);
      expect(makeService(['EXCL']).isSpaceExcluded('excl')).toBe(true);
    });

    it('returns false when space key is not in excluded list', () => {
      expect(makeService(['EXCL']).isSpaceExcluded('ALLOWED')).toBe(false);
    });

    it('returns false when exclusion list is empty', () => {
      expect(makeService([]).isSpaceExcluded('ANYTHING')).toBe(false);
    });
  });

  describe('getContent', () => {
    it('blocks and returns error when retrieved content belongs to excluded space', async () => {
      (ContentResourceService.getContentById as jest.Mock).mockResolvedValue({
        id: '123', type: 'page', title: 'T',
        space: { key: 'EXCL' },
        body: { storage: { value: '', representation: 'storage' } },
      });
      const result = await makeService(['EXCL']).getContent('123');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EXCL/);
    });

    it('returns content normally when space is not excluded', async () => {
      const mockContent = {
        id: '123', type: 'page', title: 'T',
        space: { key: 'ALLOWED' },
        body: { storage: { value: '<p>Hi</p>', representation: 'storage' } },
      };
      (ContentResourceService.getContentById as jest.Mock).mockResolvedValue(mockContent);
      const result = await makeService(['EXCL']).getContent('123');
      expect(result.success).toBe(true);
      expect(ContentResourceService.getContentById).toHaveBeenCalledWith('123', 'body.storage');
    });

    it('still fetches from API before checking space exclusion', async () => {
      (ContentResourceService.getContentById as jest.Mock).mockResolvedValue({
        id: '99', type: 'page', title: 'S', space: { key: 'EXCL' },
        body: { storage: { value: '', representation: 'storage' } },
      });
      await makeService(['EXCL']).getContent('99');
      expect(ContentResourceService.getContentById).toHaveBeenCalledWith('99', 'body.storage');
    });
  });

  describe('edge cases', () => {
    it('is case-insensitive: lowercase exclusion blocks uppercase space key', async () => {
      const result = await makeService(['excl']).createContent({ type: 'page', title: 'T', space: { key: 'EXCL' } });
      expect(result.success).toBe(false);
      expect(ContentResourceService.createContent).not.toHaveBeenCalled();
    });

    it('is case-insensitive: uppercase exclusion blocks lowercase space key', async () => {
      const result = await makeService(['EXCL']).createContent({ type: 'page', title: 'T', space: { key: 'excl' } });
      expect(result.success).toBe(false);
      expect(ContentResourceService.createContent).not.toHaveBeenCalled();
    });

    it('does not block when exclusion list is empty', async () => {
      (ContentResourceService.createContent as jest.Mock).mockResolvedValue({ id: '1' });
      const result = await makeService([]).createContent({ type: 'page', title: 'T', space: { key: 'ANYTHING' } });
      expect(result.success).toBe(true);
      expect(ContentResourceService.createContent).toHaveBeenCalled();
    });

    it('error message identifies the blocked space key', async () => {
      const result = await makeService(['BLOCKED']).createContent({ type: 'page', title: 'T', space: { key: 'BLOCKED' } });
      expect(result.error).toContain('BLOCKED');
      expect(result.error).toContain('excluded');
    });
  });
});
