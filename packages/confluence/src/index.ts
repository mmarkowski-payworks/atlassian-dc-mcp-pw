import { connectServer, initializeRuntimeConfig } from '@atlassian-dc-mcp/common';
import { ConfluenceService } from './confluence-service.js';
import { getConfluenceExcludedSpaces, getConfluenceRuntimeConfig, getDefaultPageSize } from './config.js';
import { createConfluenceServer } from './server-factory.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

initializeRuntimeConfig();

const missingEnvVars = ConfluenceService.validateConfig();
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const confluenceConfig = getConfluenceRuntimeConfig();
const confluenceService = new ConfluenceService(
  confluenceConfig.host,
  () => getConfluenceRuntimeConfig().token,
  confluenceConfig.apiBasePath,
  getDefaultPageSize,
  getConfluenceExcludedSpaces,
);

await connectServer(createConfluenceServer(confluenceService, version));
