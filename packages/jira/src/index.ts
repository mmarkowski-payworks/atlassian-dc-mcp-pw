import { connectServer, initializeRuntimeConfig } from '@atlassian-dc-mcp/common';
import { JiraService } from './jira-service.js';
import { getDefaultPageSize, getJiraExcludedProjects, getJiraRuntimeConfig } from './config.js';
import { createJiraServer } from './server-factory.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

initializeRuntimeConfig();

const missingEnvVars = JiraService.validateConfig();
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const jiraConfig = getJiraRuntimeConfig();
const jiraService = new JiraService(
  jiraConfig.host,
  () => getJiraRuntimeConfig().token,
  jiraConfig.apiBasePath,
  getDefaultPageSize,
  getJiraExcludedProjects,
);

await connectServer(createJiraServer(jiraService, version));
