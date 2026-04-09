import { getProductRuntimeConfig, validateProductRuntimeConfig } from '@atlassian-dc-mcp/common';

export function getBitbucketRuntimeConfig() {
  return getProductRuntimeConfig('bitbucket');
}

export function getDefaultPageSize() {
  return getBitbucketRuntimeConfig().defaultPageSize;
}

export function getBitbucketExcludedRepos(): string[] {
  return getBitbucketRuntimeConfig().excludedItems;
}

export function getMissingConfig() {
  return validateProductRuntimeConfig('bitbucket');
}
