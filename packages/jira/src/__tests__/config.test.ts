import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Jira config', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of [
      'ATLASSIAN_DC_MCP_CONFIG_FILE',
      'JIRA_HOST', 'JIRA_API_TOKEN', 'JIRA_API_BASE_PATH', 'JIRA_DEFAULT_PAGE_SIZE', 'JIRA_EXCLUDED_PROJECTS',
    ]) {
      delete process.env[key];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-config-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the configured page size when the env var is a positive integer', async () => {
    process.env.JIRA_DEFAULT_PAGE_SIZE = '40';

    const { getDefaultPageSize } = await import('../config.js');

    expect(getDefaultPageSize()).toBe(40);
  });

  it('falls back to 25 when the env var is invalid', async () => {
    process.env.JIRA_DEFAULT_PAGE_SIZE = 'invalid';

    const { getDefaultPageSize } = await import('../config.js');

    expect(getDefaultPageSize()).toBe(25);
  });

  it('reads the page size from the shared config file', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=file-host\nJIRA_API_TOKEN=file-token\nJIRA_DEFAULT_PAGE_SIZE=35\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;

    const { getDefaultPageSize, getJiraRuntimeConfig } = await import('../config.js');

    expect(getDefaultPageSize()).toBe(35);
    expect(getJiraRuntimeConfig().token).toBe('file-token');
  });

  it('keeps env values higher priority than the shared config file', async () => {
    const sharedConfigPath = path.join(tempDir, 'shared.env');
    fs.writeFileSync(sharedConfigPath, 'JIRA_HOST=file-host\nJIRA_API_TOKEN=file-token\nJIRA_DEFAULT_PAGE_SIZE=35\n');
    process.env.ATLASSIAN_DC_MCP_CONFIG_FILE = sharedConfigPath;
    process.env.JIRA_DEFAULT_PAGE_SIZE = '45';

    const { getDefaultPageSize } = await import('../config.js');

    expect(getDefaultPageSize()).toBe(45);
  });
});
