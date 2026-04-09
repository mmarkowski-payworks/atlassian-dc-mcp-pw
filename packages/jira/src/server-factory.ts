import { createMcpServer, formatToolResponse } from '@atlassian-dc-mcp/common';
import { JiraService, jiraToolSchemas } from './jira-service.js';

const JIRA_INSTANCE_TYPE = 'JIRA Data Center edition instance';

export function createJiraServer(service: JiraService, version = '0.0.0-test') {
  const server = createMcpServer({ name: 'atlassian-jira-mcp', version });

  server.tool(
    'jira_searchIssues',
    `Search for JIRA issues using JQL in the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.searchIssues,
    async ({ jql, expand, startAt, maxResults, fields }) => {
      const result = await service.searchIssues(jql, startAt, expand, maxResults, fields);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_getIssue',
    `Get details of a JIRA issue by its key from the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.getIssue,
    async ({ issueKey, expand, fields }) => {
      const result = await service.getIssue(issueKey, expand, fields);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_getIssueComments',
    `Get comments of a JIRA issue by its key from the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.getIssueComments,
    async ({ issueKey, expand, maxResults, startAt }) => {
      const result = await service.getIssueComments(issueKey, expand, maxResults, startAt);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_createIssue',
    `Create a new JIRA issue in the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.createIssue,
    async (params) => {
      const result = await service.createIssue(params);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_updateIssue',
    `Update an existing JIRA issue in the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.updateIssue,
    async (params) => {
      const result = await service.updateIssue(params);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_postIssueComment',
    `Post a comment on a JIRA issue in the ${JIRA_INSTANCE_TYPE}`,
    jiraToolSchemas.postIssueComment,
    async ({ issueKey, comment }) => {
      const result = await service.postIssueComment(issueKey, comment);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_getTransitions',
    `Get available status transitions for a JIRA issue in the ${JIRA_INSTANCE_TYPE}. Returns a list of transitions with their IDs, names, and target statuses.`,
    jiraToolSchemas.getTransitions,
    async ({ issueKey }) => {
      const result = await service.getTransitions(issueKey);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'jira_transitionIssue',
    `Transition a JIRA issue to a new status in the ${JIRA_INSTANCE_TYPE}. Use jira_getTransitions first to get available transition IDs.`,
    jiraToolSchemas.transitionIssue,
    async (params) => {
      const result = await service.transitionIssue(params);
      return formatToolResponse(result);
    }
  );

  return server;
}
