import { connectServer, initializeRuntimeConfig } from '@atlassian-dc-mcp/common';
import { BitbucketService } from './bitbucket-service.js';
import { getBitbucketExcludedRepos, getBitbucketRuntimeConfig, getDefaultPageSize } from './config.js';
import { createBitbucketServer } from './server-factory.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

initializeRuntimeConfig();

const missingVars = BitbucketService.validateConfig();
if (missingVars.length > 0) {
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const bitbucketConfig = getBitbucketRuntimeConfig();
const bitbucketService = new BitbucketService(
  bitbucketConfig.host,
  () => getBitbucketRuntimeConfig().token,
  bitbucketConfig.apiBasePath,
  getDefaultPageSize,
  getBitbucketExcludedRepos,
);

await connectServer(createBitbucketServer(bitbucketService, version));
