import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('runtime config loader', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of [
      'ATLASSIAN_DC_MCP_CONFIG_FILE',
      'JIRA_HOST', 'JIRA_API_TOKEN', 'JIRA_API_BASE_PATH', 'JIRA_DEFAULT_PAGE_SIZE', 'JIRA_EXCLUDED_PROJECTS',
      'CONFLUENCE_HOST', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_API_BASE_PATH', 'CONFLUENCE_DEFAULT_PAGE_SIZE', 'CONFLUENCE_EXCLUDED_SPACES',
      'BITBUCKET_HOST', 'BITBUCKET_API_TOKEN', 'BITBUCKET_API_BASE_PATH', 'BITBUCKET_DEFAULT_PAGE_SIZE',
    ]) {
      delete process.env[key];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlassian-dc-mcp-config-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads an explicit shared config file', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=file-host\nJIRA_API_TOKEN=file-token\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');

    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('jira')).toEqual({
      host: 'file-host',
      apiBasePath: undefined,
      token: 'file-token',
      defaultPageSize: 25,
      excludedItems: [],
    });
  });

  it('throws when the explicit shared config file is missing', async () => {
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = path.join(tempDir, 'missing.env');

    const { initializeRuntimeConfig } = await import('../runtime-config.js');

    expect(() => initializeRuntimeConfig({ cwd: tempDir })).toThrow(
      `ATLASSIAN_DC_MCP_CONFIG_FILE points to a missing file: ${path.join(tempDir, 'missing.env')}`,
    );
  });

  it('requires an absolute shared config file path', async () => {
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = 'relative/shared.env';

    const { initializeRuntimeConfig } = await import('../runtime-config.js');

    expect(() => initializeRuntimeConfig({ cwd: tempDir })).toThrow(
      'ATLASSIAN_DC_MCP_CONFIG_FILE must be an absolute path: relative/shared.env',
    );
  });

  it('keeps environment variables higher priority than file values', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=file-host\nJIRA_API_TOKEN=file-token\nJIRA_DEFAULT_PAGE_SIZE=50\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;
    process.env.JIRA_API_TOKEN = 'env-token';
    process.env.JIRA_DEFAULT_PAGE_SIZE = '10';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');

    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('jira')).toEqual({
      host: 'file-host',
      apiBasePath: undefined,
      token: 'env-token',
      defaultPageSize: 10,
      excludedItems: [],
    });
  });

  it('falls back to the cwd .env file when no explicit shared file is configured', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'CONFLUENCE_HOST=cwd-host\nCONFLUENCE_API_TOKEN=cwd-token\nCONFLUENCE_DEFAULT_PAGE_SIZE=30\n',
    );

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');

    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('confluence')).toEqual({
      host: 'cwd-host',
      apiBasePath: undefined,
      token: 'cwd-token',
      defaultPageSize: 30,
      excludedItems: [],
    });
  });

  it('parses JIRA_EXCLUDED_PROJECTS from env var into excludedItems', async () => {
    process.env.JIRA_HOST = 'host';
    process.env.JIRA_API_TOKEN = 'token';
    process.env.JIRA_EXCLUDED_PROJECTS = 'PROJ1, PROJ2 , PROJ3';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual(['PROJ1', 'PROJ2', 'PROJ3']);
  });

  it('parses CONFLUENCE_EXCLUDED_SPACES from a config file into excludedItems', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'CONFLUENCE_HOST=host\nCONFLUENCE_API_TOKEN=token\nCONFLUENCE_EXCLUDED_SPACES=~PERSONAL,ARCHIVE\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('confluence').excludedItems).toEqual(['~PERSONAL', 'ARCHIVE']);
  });

  it('returns empty excludedItems when exclusion var is not set', async () => {
    process.env.JIRA_HOST = 'host';
    process.env.JIRA_API_TOKEN = 'token';
    delete process.env.JIRA_EXCLUDED_PROJECTS;

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual([]);
  });

  it('env var takes priority over file value for excluded items', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=host\nJIRA_API_TOKEN=token\nJIRA_EXCLUDED_PROJECTS=FILE_PROJ\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;
    process.env.JIRA_EXCLUDED_PROJECTS = 'ENV_PROJ';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual(['ENV_PROJ']);
  });

  it('refreshes the cached file when its mtime changes', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'BITBUCKET_HOST=file-host\nBITBUCKET_API_TOKEN=token-a\n');
    const initialTime = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(sharedConfigPath, initialTime, initialTime);
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');

    initializeRuntimeConfig({ cwd: tempDir });
    expect(getProductRuntimeConfig('bitbucket').token).toBe('token-a');

    fs.writeFileSync(sharedConfigPath, 'BITBUCKET_HOST=file-host\nBITBUCKET_API_TOKEN=token-b\n');
    const updatedTime = new Date('2026-01-01T00:00:01.000Z');
    fs.utimesSync(sharedConfigPath, updatedTime, updatedTime);

    expect(getProductRuntimeConfig('bitbucket').token).toBe('token-b');
  });
});

describe('org config file exclusion enforcement', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of [
      'ATLASSIAN_DC_MCP_CONFIG_FILE',
      'JIRA_HOST', 'JIRA_API_TOKEN', 'JIRA_API_BASE_PATH', 'JIRA_DEFAULT_PAGE_SIZE', 'JIRA_EXCLUDED_PROJECTS',
      'CONFLUENCE_HOST', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_API_BASE_PATH', 'CONFLUENCE_DEFAULT_PAGE_SIZE', 'CONFLUENCE_EXCLUDED_SPACES',
      'BITBUCKET_HOST', 'BITBUCKET_API_TOKEN', 'BITBUCKET_API_BASE_PATH', 'BITBUCKET_DEFAULT_PAGE_SIZE',
    ]) {
      delete process.env[key];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlassian-dc-mcp-org-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads excluded projects from org config file', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1,ORG_PROJ2\n');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual(['ORG_PROJ1', 'ORG_PROJ2']);
  });

  it('reads excluded spaces for confluence from org config file', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'CONFLUENCE_EXCLUDED_SPACES=ORG_SPACE\n');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    expect(getProductRuntimeConfig('confluence').excludedItems).toEqual(['ORG_SPACE']);
  });

  it('unions org exclusions with user env var exclusions — org entries come first', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1,ORG_PROJ2\n');
    process.env.JIRA_EXCLUDED_PROJECTS = 'USER_PROJ';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    const items = getProductRuntimeConfig('jira').excludedItems;
    expect(items).toContain('ORG_PROJ1');
    expect(items).toContain('ORG_PROJ2');
    expect(items).toContain('USER_PROJ');
    expect(items.indexOf('ORG_PROJ1')).toBeLessThan(items.indexOf('USER_PROJ'));
  });

  it('org exclusions persist even when user sets env var to empty', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1,ORG_PROJ2\n');
    process.env.JIRA_EXCLUDED_PROJECTS = '';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    const items = getProductRuntimeConfig('jira').excludedItems;
    expect(items).toContain('ORG_PROJ1');
    expect(items).toContain('ORG_PROJ2');
  });

  it('org exclusions persist even when user sets file config to empty', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1\n');
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=host\nJIRA_API_TOKEN=tok\nJIRA_EXCLUDED_PROJECTS=\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    expect(getProductRuntimeConfig('jira').excludedItems).toContain('ORG_PROJ1');
  });

  it('deduplicates items present in both org config and user env var', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1,ORG_PROJ2\n');
    process.env.JIRA_EXCLUDED_PROJECTS = 'ORG_PROJ1,USER_PROJ';

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    const items = getProductRuntimeConfig('jira').excludedItems;
    expect(items.filter(i => i === 'ORG_PROJ1')).toHaveLength(1);
    expect(items).toContain('ORG_PROJ2');
    expect(items).toContain('USER_PROJ');
  });

  it('silently ignores an absent org config file and returns no org exclusions', async () => {
    const orgConfigPath = path.join(tempDir, 'nonexistent-org.env');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual([]);
  });

  it('org config file is read only once per initializeRuntimeConfig call (cached)', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1\n');

    const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    const callsBefore = readFileSyncSpy.mock.calls.filter(
      args => args[0] === orgConfigPath,
    ).length;

    getProductRuntimeConfig('jira');
    getProductRuntimeConfig('jira');
    getProductRuntimeConfig('confluence');

    const callsAfter = readFileSyncSpy.mock.calls.filter(
      args => args[0] === orgConfigPath,
    ).length;

    // Org file is read lazily on the first getProductRuntimeConfig call, then cached.
    // Across three calls it should be read exactly once.
    expect(callsAfter - callsBefore).toBe(1);
    readFileSyncSpy.mockRestore();
  });

  it('re-reads org config file after a second initializeRuntimeConfig call', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ1\n');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');

    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });
    expect(getProductRuntimeConfig('jira').excludedItems).toContain('ORG_PROJ1');

    fs.writeFileSync(orgConfigPath, 'JIRA_EXCLUDED_PROJECTS=ORG_PROJ2\n');

    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });
    expect(getProductRuntimeConfig('jira').excludedItems).toContain('ORG_PROJ2');
    expect(getProductRuntimeConfig('jira').excludedItems).not.toContain('ORG_PROJ1');
  });

  it('returns empty excludedItems when org config file has no exclusion keys', async () => {
    const orgConfigPath = path.join(tempDir, 'org.env');
    fs.writeFileSync(orgConfigPath, 'SOME_OTHER_KEY=value\n');

    const { getProductRuntimeConfig, initializeRuntimeConfig } = await import('../runtime-config.js');
    initializeRuntimeConfig({ cwd: tempDir, orgConfigFilePath: orgConfigPath });

    expect(getProductRuntimeConfig('jira').excludedItems).toEqual([]);
  });
});
