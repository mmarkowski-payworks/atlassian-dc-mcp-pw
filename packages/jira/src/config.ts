import { getProductRuntimeConfig, validateProductRuntimeConfig } from '@atlassian-dc-mcp/common';

export function getJiraRuntimeConfig() {
  return getProductRuntimeConfig('jira');
}

export function getDefaultPageSize() {
  return getJiraRuntimeConfig().defaultPageSize;
}

export function getJiraExcludedProjects(): string[] {
  return getJiraRuntimeConfig().excludedItems;
}

export function getMissingConfig() {
  return validateProductRuntimeConfig('jira');
}
