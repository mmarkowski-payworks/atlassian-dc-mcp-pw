import { z } from 'zod';
import { handleApiOperation } from '@atlassian-dc-mcp/common';
import { IssueService, OpenAPI, SearchService } from './jira-client/index.js';
import type { StringList } from './jira-client/models/StringList.js';
import { getDefaultPageSize, getMissingConfig } from './config.js';

/**
 * Extracts the project key from a Jira issue key (e.g. "PROJ" from "PROJ-123").
 * Returns null if the key is not in the expected format.
 */
function extractProjectKey(issueKey: string): string | null {
  const match = issueKey.match(/^([A-Z][A-Z0-9_]*)-\d+$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Appends an exclusion clause to a JQL string, preserving any trailing ORDER BY.
 * E.g. "(original) AND project NOT IN (EXCL1, EXCL2) ORDER BY created"
 */
function appendJqlExclusion(jql: string, excludedProjects: string[]): string {
  if (excludedProjects.length === 0) return jql;
  const keys = excludedProjects.map(p => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
  const exclusionClause = `project NOT IN (${keys})`;
  const orderByMatch = jql.match(/(\s+ORDER\s+BY\s+.+)$/i);
  if (orderByMatch) {
    const baseJql = jql.slice(0, jql.length - orderByMatch[0].length).trim();
    return `(${baseJql}) AND ${exclusionClause}${orderByMatch[0]}`;
  }
  return `(${jql}) AND ${exclusionClause}`;
}

const DEFAULT_SEARCH_FIELDS = ['summary', 'description', 'status', 'assignee', 'reporter', 'priority', 'issuetype', 'labels', 'updated'];
const DEFAULT_ISSUE_FIELDS = [...DEFAULT_SEARCH_FIELDS, 'parent', 'subtasks'];

function toIssueFieldSelection(fields: string[]): Array<StringList> {
  // The generated client types this query param as StringList[], but the API expects repeated string field names.
  return fields as unknown as Array<StringList>;
}

function resolveToken(token: string | (() => string | undefined), missingTokenMessage: string) {
  return async () => {
    const resolvedToken = typeof token === 'function' ? token() : token;
    if (!resolvedToken) {
      throw new Error(missingTokenMessage);
    }
    return resolvedToken;
  };
}

export class JiraService {
  private readonly getPageSize: () => number;
  private readonly getExcludedProjects: () => string[];

  constructor(
    host: string | undefined,
    token: string | (() => string | undefined),
    fullBaseUrl?: string,
    getPageSize: () => number = getDefaultPageSize,
    getExcludedProjects: () => string[] = () => [],
  ) {
    if (fullBaseUrl) {
      OpenAPI.BASE = fullBaseUrl;
    } else if (host) {
      OpenAPI.BASE = `https://${host}/rest`;
    } else {
      throw new Error('Either host or fullBaseUrl must be provided');
    }

    OpenAPI.TOKEN = resolveToken(token, 'Missing required environment variable: JIRA_API_TOKEN');
    OpenAPI.VERSION = '2';
    this.getPageSize = getPageSize;
    this.getExcludedProjects = getExcludedProjects;
  }

  private checkProjectExcluded(issueKey: string) {
    const excluded = this.getExcludedProjects();
    if (excluded.length === 0) return null;
    const projectKey = extractProjectKey(issueKey);
    if (projectKey && excluded.map(p => p.toUpperCase()).includes(projectKey)) {
      return { success: false as const, data: undefined, error: `Project ${projectKey} is excluded from this Jira MCP server` };
    }
    return null;
  }

  async searchIssues(jql: string, startAt?: number, expand?: string[], maxResults?: number, fields?: string[]) {
    const excluded = this.getExcludedProjects();
    const effectiveJql = excluded.length > 0 ? appendJqlExclusion(jql, excluded) : jql;
    return handleApiOperation(() => {
      return SearchService.searchUsingSearchRequest({
        jql: effectiveJql,
        maxResults: maxResults ?? this.getPageSize(),
        fields: fields ?? DEFAULT_SEARCH_FIELDS,
        expand,
        startAt
      });
    }, 'Error searching issues');
  }

  async getIssue(issueKey: string, expand?: string, fields?: string[]) {
    const exclusionError = this.checkProjectExcluded(issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(
      () => IssueService.getIssue(issueKey, expand, toIssueFieldSelection(fields ?? DEFAULT_ISSUE_FIELDS)),
      'Error getting issue'
    );
  }

  async getIssueComments(issueKey: string, expand?: string, maxResults?: number, startAt?: number) {
    const exclusionError = this.checkProjectExcluded(issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(
      () => IssueService.getComments(issueKey, expand, (maxResults ?? this.getPageSize()).toString(), undefined, startAt?.toString()),
      'Error getting issue comments'
    );
  }

  async postIssueComment(issueKey: string, comment: string) {
    const exclusionError = this.checkProjectExcluded(issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(() => IssueService.addComment(issueKey, undefined, { body: comment }), 'Error posting issue comment');
  }

  async createIssue(params: {
    projectId: string;
    summary: string;
    description: string;
    issueTypeId: string;
    customFields?: Record<string, any>;
  }) {
    const excluded = this.getExcludedProjects().map(p => p.toUpperCase());
    if (excluded.includes(params.projectId.toUpperCase())) {
      return { success: false as const, data: undefined, error: `Project ${params.projectId.toUpperCase()} is excluded from this Jira MCP server` };
    }
    return handleApiOperation(async () => {
      const standardFields = {
        project: { key: params.projectId },
        summary: params.summary,
        description: params.description,
        issuetype: { id: params.issueTypeId }
      };

      // Strip protected fields from customFields to prevent overriding the project,
      // which would bypass the exclusion check above.
      const { project: _p, ...safeCustomFields } = params.customFields ?? {};
      const fields = Object.keys(safeCustomFields).length > 0
        ? { ...standardFields, ...safeCustomFields }
        : standardFields;

      return IssueService.createIssue(true, { fields });
    }, 'Error creating issue');
  }

  async updateIssue(params: {
    issueKey: string;
    summary?: string;
    description?: string;
    issueTypeId?: string;
    customFields?: Record<string, any>;
  }) {
    const exclusionError = this.checkProjectExcluded(params.issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(async () => {
      const standardFields: Record<string, any> = {};
      if (params.summary !== undefined) {
        standardFields.summary = params.summary;
      }
      if (params.description !== undefined) {
        standardFields.description = params.description;
      }
      if (params.issueTypeId !== undefined) {
        standardFields.issuetype = { id: params.issueTypeId };
      }

      // Strip project from customFields for consistency with createIssue.
      const { project: _p, ...safeCustomFields } = params.customFields ?? {};
      const fields = Object.keys(safeCustomFields).length > 0
        ? { ...standardFields, ...safeCustomFields }
        : standardFields;

      return IssueService.editIssue(params.issueKey, 'true', { fields });
    }, 'Error updating issue');
  }

  async getTransitions(issueKey: string) {
    const exclusionError = this.checkProjectExcluded(issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(
      () => IssueService.getTransitions(issueKey),
      'Error getting transitions'
    );
  }

  async transitionIssue(params: {
    issueKey: string;
    transitionId: string;
    fields?: Record<string, any>;
  }) {
    const exclusionError = this.checkProjectExcluded(params.issueKey);
    if (exclusionError) return exclusionError;
    return handleApiOperation(async () => {
      const requestBody: { transition: { id: string }; fields?: Record<string, any> } = {
        transition: { id: params.transitionId }
      };
      if (params.fields) {
        requestBody.fields = params.fields;
      }
      return IssueService.doTransition(params.issueKey, requestBody);
    }, 'Error transitioning issue');
  }

  static validateConfig(): string[] {
    return getMissingConfig();
  }
}

export const jiraToolSchemas = {
  searchIssues: {
    jql: z.string().max(10000).describe("JQL query string"),
    maxResults: z.number().int().min(1).max(500).optional().describe("Maximum number of results to return"),
    startAt: z.number().int().min(0).optional().describe("Index of the first result to return"),
    expand: z.array(z.string().max(100)).max(20).optional().describe("Additional sections to expand in the search response, such as renderedFields, names, or schema"),
    fields: z.array(z.string().max(100)).max(100).optional().describe("Issue field names to include in the response. When omitted, a moderate-detail default field set is used.")
  },
  getIssue: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)"),
    expand: z.string().max(500).optional().describe("Comma-separated response sections to expand, such as renderedFields, changelog, or transitions"),
    fields: z.array(z.string().max(100)).max(100).optional().describe("Issue field names to include in the response. When omitted, a moderate-detail default field set is used.")
  },
  getIssueComments: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)"),
    expand: z.string().max(500).optional().describe("Comma-separated comment expansions, such as renderedBody"),
    maxResults: z.number().int().min(1).max(500).optional().describe("Maximum number of comments to return"),
    startAt: z.number().int().min(0).optional().describe("Index of the first comment to return")
  },
  postIssueComment: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)"),
    comment: z.string().max(32000).describe("Comment text in the format suitable for JIRA DATA CENTER edition (JIRA Wiki Markup).")
  },
  createIssue: {
    projectId: z.string().max(50).describe("Project key (despite the parameter name, e.g. TEST)"),
    summary: z.string().max(255).describe("Issue summary"),
    description: z.string().max(32000).describe("Issue description in the format suitable for JIRA DATA CENTER edition (JIRA Wiki Markup)."),
    issueTypeId: z.string().max(50).describe("Issue type id (e.g. id of Task, Bug, Story). Should be found first a correct number for specific JIRA installation."),
    customFields: z.record(z.any()).refine(v => Object.keys(v).length <= 50, { message: 'customFields must not exceed 50 entries' }).optional().describe("Optional fields merged into the JIRA create payload. Can be used for custom fields and standard fields such as labels. Examples: {'customfield_10001': 'Custom Value', 'priority': {'id': '1'}, 'assignee': {'name': 'john.doe'}, 'labels': ['urgent', 'bug']}")
  },
  updateIssue: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)"),
    summary: z.string().max(255).optional().describe("New summary (optional)"),
    description: z.string().max(32000).optional().describe("New description in JIRA Wiki Markup (optional)"),
    issueTypeId: z.string().max(50).optional().describe("New issue type id (optional)"),
    customFields: z.record(z.any()).refine(v => Object.keys(v).length <= 50, { message: 'customFields must not exceed 50 entries' }).optional().describe("Optional fields merged into the JIRA update payload. Can be used for custom fields and standard fields such as labels. Examples: {'customfield_10001': 'Custom Value', 'priority': {'id': '1'}, 'assignee': {'name': 'john.doe'}, 'labels': ['urgent', 'bug']}")
  },
  getTransitions: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)")
  },
  transitionIssue: {
    issueKey: z.string().max(50).describe("JIRA issue key (e.g., PROJ-123)"),
    transitionId: z.string().max(20).describe("The ID of the transition to perform. Use jira_getTransitions to find available transitions and their IDs."),
    fields: z.record(z.any()).refine(v => Object.keys(v).length <= 50, { message: 'fields must not exceed 50 entries' }).optional().describe("Optional fields required by the transition screen. Use jira_getTransitions to see which fields are available for each transition.")
  }
};
