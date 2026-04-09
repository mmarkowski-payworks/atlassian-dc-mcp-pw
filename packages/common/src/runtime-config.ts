import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const FALLBACK_PAGE_SIZE = 25;

export const ATLASSIAN_DC_MCP_CONFIG_FILE_ENV_VAR = 'ATLASSIAN_DC_MCP_CONFIG_FILE';

export type AtlassianProduct = 'jira' | 'confluence' | 'bitbucket';

type ProductMetadata = {
  hostKey: string;
  apiBasePathKey: string;
  tokenKey: string;
  defaultPageSizeKey: string;
  excludedItemsKey?: string;
};

type ParsedEnvironment = Record<string, string>;

type RuntimeConfigState = {
  cwd: string;
  orgConfigFilePath: string;
  cachedFile?: {
    filePath: string;
    mtimeMs: number;
    values: ParsedEnvironment;
  };
  // undefined = not yet read; populated lazily, reset on each initializeRuntimeConfig.
  cachedOrgFile?: ParsedEnvironment;
};

export type ProductRuntimeConfig = {
  host?: string;
  apiBasePath?: string;
  token?: string;
  defaultPageSize: number;
  excludedItems: string[];
};

const PRODUCT_METADATA: Record<AtlassianProduct, ProductMetadata> = {
  jira: {
    hostKey: 'JIRA_HOST',
    apiBasePathKey: 'JIRA_API_BASE_PATH',
    tokenKey: 'JIRA_API_TOKEN',
    defaultPageSizeKey: 'JIRA_DEFAULT_PAGE_SIZE',
    excludedItemsKey: 'JIRA_EXCLUDED_PROJECTS',
  },
  confluence: {
    hostKey: 'CONFLUENCE_HOST',
    apiBasePathKey: 'CONFLUENCE_API_BASE_PATH',
    tokenKey: 'CONFLUENCE_API_TOKEN',
    defaultPageSizeKey: 'CONFLUENCE_DEFAULT_PAGE_SIZE',
    excludedItemsKey: 'CONFLUENCE_EXCLUDED_SPACES',
  },
  bitbucket: {
    hostKey: 'BITBUCKET_HOST',
    apiBasePathKey: 'BITBUCKET_API_BASE_PATH',
    tokenKey: 'BITBUCKET_API_TOKEN',
    defaultPageSizeKey: 'BITBUCKET_DEFAULT_PAGE_SIZE',
    excludedItemsKey: 'BITBUCKET_EXCLUDED_REPOS',
  },
};

/**
 * Returns the well-known org config file path for the current platform.
 * Windows: %PROGRAMDATA%\AtlassianMCP\org.env
 * Linux/macOS: /etc/atlassian-dc-mcp/org.env
 *
 * This path is intentionally hard-wired and not user-configurable so that
 * org-level exclusions cannot be bypassed by redirecting a pointer env var.
 * Admins deploy this file via SCCM/Intune/GPO (Windows) or configuration
 * management (Linux). The file is silently ignored when absent.
 */
function getDefaultOrgConfigFilePath(): string {
  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA ?? 'C:\\ProgramData';
    return path.join(programData, 'AtlassianMCP', 'org.env');
  }
  return '/etc/atlassian-dc-mcp/org.env';
}

const runtimeConfigState: RuntimeConfigState = {
  cwd: process.cwd(),
  orgConfigFilePath: getDefaultOrgConfigFilePath(),
};

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : undefined;
}

function parseStringList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function getNonEmptyValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reads the org config file once per initializeRuntimeConfig cycle.
 * Silently returns {} when the file is absent or unreadable — the org
 * config file is optional; environments without it (dev machines, CI,
 * ephemeral containers) continue to work normally.
 */
function getParsedOrgFileEnvironment(): ParsedEnvironment {
  if (runtimeConfigState.cachedOrgFile !== undefined) {
    return runtimeConfigState.cachedOrgFile;
  }

  try {
    const content = fs.readFileSync(runtimeConfigState.orgConfigFilePath);
    runtimeConfigState.cachedOrgFile = dotenv.parse(content);
  } catch {
    runtimeConfigState.cachedOrgFile = {};
  }

  return runtimeConfigState.cachedOrgFile;
}

function getExplicitConfigFilePath(): string | undefined {
  const filePath = getNonEmptyValue(process.env[ATLASSIAN_DC_MCP_CONFIG_FILE_ENV_VAR]);
  if (!filePath) {
    return undefined;
  }

  if (!path.isAbsolute(filePath)) {
    throw new Error(`${ATLASSIAN_DC_MCP_CONFIG_FILE_ENV_VAR} must be an absolute path: ${filePath}`);
  }

  return filePath;
}

function clearCachedFileIfNeeded(filePath: string) {
  if (runtimeConfigState.cachedFile?.filePath === filePath) {
    runtimeConfigState.cachedFile = undefined;
  }
}

function getParsedFileEnvironment(): ParsedEnvironment {
  const explicitFilePath = getExplicitConfigFilePath();
  const filePath = explicitFilePath ?? path.join(runtimeConfigState.cwd, '.env');

  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    clearCachedFileIfNeeded(filePath);

    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !explicitFilePath) {
      return {};
    }

    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && explicitFilePath) {
      throw new Error(`${ATLASSIAN_DC_MCP_CONFIG_FILE_ENV_VAR} points to a missing file: ${filePath}`);
    }

    throw error;
  }

  const cachedFile = runtimeConfigState.cachedFile;
  if (cachedFile && cachedFile.filePath === filePath && cachedFile.mtimeMs === stats.mtimeMs) {
    return cachedFile.values;
  }

  const values = dotenv.parse(fs.readFileSync(filePath));
  runtimeConfigState.cachedFile = {
    filePath,
    mtimeMs: stats.mtimeMs,
    values,
  };
  return values;
}

function getMergedEnvironment(): NodeJS.ProcessEnv {
  return {
    ...getParsedFileEnvironment(),
    ...process.env,
  };
}

export function initializeRuntimeConfig(options?: { cwd?: string; orgConfigFilePath?: string }) {
  runtimeConfigState.cwd = options?.cwd ?? process.cwd();
  runtimeConfigState.orgConfigFilePath = options?.orgConfigFilePath ?? getDefaultOrgConfigFilePath();
  runtimeConfigState.cachedOrgFile = undefined;
  getParsedFileEnvironment();
}

export function getProductRuntimeConfig(product: AtlassianProduct): ProductRuntimeConfig {
  const environment = getMergedEnvironment();
  const orgEnv = getParsedOrgFileEnvironment();
  const metadata = PRODUCT_METADATA[product];

  // Org exclusions (from the admin-deployed org.env) are unioned with user
  // exclusions and deduplicated. Org entries come first and cannot be removed
  // by user-level env vars or config files — users can only add to the list.
  const orgExclusions = metadata.excludedItemsKey
    ? parseStringList(orgEnv[metadata.excludedItemsKey])
    : [];
  const userExclusions = metadata.excludedItemsKey
    ? parseStringList(environment[metadata.excludedItemsKey])
    : [];
  const excludedItems = [...new Set([...orgExclusions, ...userExclusions])];

  return {
    host: getNonEmptyValue(environment[metadata.hostKey]),
    apiBasePath: getNonEmptyValue(environment[metadata.apiBasePathKey]),
    token: getNonEmptyValue(environment[metadata.tokenKey]),
    defaultPageSize: parsePositiveInteger(environment[metadata.defaultPageSizeKey]) ?? FALLBACK_PAGE_SIZE,
    excludedItems,
  };
}

export function validateProductRuntimeConfig(product: AtlassianProduct): string[] {
  const metadata = PRODUCT_METADATA[product];
  const config = getProductRuntimeConfig(product);
  const missing: string[] = [];

  if (!config.token) {
    missing.push(metadata.tokenKey);
  }

  if (!config.host && !config.apiBasePath) {
    missing.push(`${metadata.hostKey} or ${metadata.apiBasePathKey}`);
  }

  return missing;
}
