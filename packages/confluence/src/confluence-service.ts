import { z } from 'zod';
import { ContentResourceService, OpenAPI, SearchService } from './confluence-client/index.js';
import { handleApiOperation } from '@atlassian-dc-mcp/common';
import { getDefaultPageSize, getMissingConfig } from './config.js';
import { ConfluenceBodyMode, shapeConfluenceContent } from './confluence-response-mapper.js';

const ESCAPED_DOUBLE_QUOTE = String.raw`\"`;

/**
 * Appends a space exclusion clause to a CQL string, preserving any trailing ORDER BY.
 * E.g. "(original) AND space.key NOT IN ("EXCL1","EXCL2") ORDER BY created"
 */
function escapeCqlKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, ESCAPED_DOUBLE_QUOTE);
}

function appendCqlSpaceExclusion(cql: string, excludedSpaces: string[]): string {
  if (excludedSpaces.length === 0) return cql;
  const keys = excludedSpaces.map(s => `"${escapeCqlKey(s)}"`).join(', ');
  const exclusionClause = `space.key NOT IN (${keys})`;
  const orderByMatch = cql.match(/(\s+ORDER\s+BY\s+.+)$/i);
  if (orderByMatch) {
    const baseCql = cql.slice(0, cql.length - orderByMatch[0].length).trim();
    return `(${baseCql}) AND ${exclusionClause}${orderByMatch[0]}`;
  }
  return `(${cql}) AND ${exclusionClause}`;
}

/**
 * Escapes user input for safe use inside a CQL quoted string.
 * Escapes backslash first, then double quote, so that neither can break out of the phrase.
 * Only call once per value; double-escaping would over-escape and break the query.
 */
export function escapeSearchTextForCql(searchText: string): string {
  return searchText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface ConfluenceContent {
  id?: string;
  type: string;
  title: string;
  space: {
    key: string;
  };
  body?: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
  version?: {
    number: number;
    message?: string;
  };
  ancestors?: Array<{ id: string }>;
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

export class ConfluenceService {
  private readonly getPageSize: () => number;
  private readonly getExcludedSpaces: () => string[];

  /**
   * Creates a new ConfluenceService instance
   * @param host The hostname of the Confluence server (e.g., "host.com")
   * @param token The API token for authentication
   * @param fullApiUrl Optional full API URL (e.g., "https://host.com/wiki/"). If provided, host and apiBasePath are ignored.
   */
  constructor(
    host: string | undefined,
    token: string | (() => string | undefined),
    fullApiUrl?: string,
    getPageSize: () => number = getDefaultPageSize,
    getExcludedSpaces: () => string[] = () => [],
  ) {
    if (fullApiUrl) {
      OpenAPI.BASE = fullApiUrl;
    } else if (host) {
      OpenAPI.BASE = `https://${host}`;
    } else {
      throw new Error('Either host or fullApiUrl must be provided');
    }
    OpenAPI.TOKEN = resolveToken(token, 'Missing required environment variable: CONFLUENCE_API_TOKEN');
    OpenAPI.VERSION = '1.0';
    this.getPageSize = getPageSize;
    this.getExcludedSpaces = getExcludedSpaces;
  }

  isSpaceExcluded(spaceKey: string): boolean {
    const excluded = this.getExcludedSpaces();
    return excluded.map(s => s.toUpperCase()).includes(spaceKey.toUpperCase());
  }

  spaceExclusionError(spaceKey: string) {
    return { success: false as const, data: undefined, error: `Space ${spaceKey.toUpperCase()} is excluded from this Confluence MCP server` };
  }
  /**
   * Get a Confluence page by ID
   * @param contentId The ID of the page to retrieve
   * @param expand Optional comma-separated list of properties to expand
   */
  async getContentRaw(contentId: string, expand?: string) {
    const expandValue = expand || 'body.storage';
    const finalExpand = expand && !expand.includes('body.storage')
      ? `${expand},body.storage`
      : expandValue;
    return handleApiOperation(() => ContentResourceService.getContentById(contentId, finalExpand), 'Error getting content');
  }

  async getContent(contentId: string, expand?: string, bodyMode: ConfluenceBodyMode = 'storage', maxBodyChars?: number) {
    const result = await this.getContentRaw(contentId, expand);
    if (result.success && result.data) {
      const spaceKey = (result.data as { space?: { key?: string } }).space?.key;
      if (spaceKey && this.isSpaceExcluded(spaceKey)) {
        return this.spaceExclusionError(spaceKey);
      }
      return {
        ...result,
        data: shapeConfluenceContent(result.data, bodyMode, maxBodyChars),
      };
    }

    return result;
  }

  /**
   * Search for content in Confluence using CQL
   * @param cql Confluence Query Language string
   * @param limit Maximum number of results to return
   * @param start Start index for pagination
   * @param expand Optional comma-separated list of properties to expand
   */
  async searchContent(cql: string, limit?: number, start?: number, expand?: string, excerpt: 'none' | 'highlight' = 'none') {
    const excluded = this.getExcludedSpaces();
    const effectiveCql = excluded.length > 0 ? appendCqlSpaceExclusion(cql, excluded) : cql;
    return handleApiOperation(
      () => SearchService.search1(
        undefined,
        expand,
        undefined,
        (limit ?? this.getPageSize()).toString(),
        start?.toString(),
        excerpt,
        effectiveCql
      ),
      'Error searching for content'
    );
  }

  /**
   * Create a new page in Confluence
   * @param content The content object to create
   */
  async createContent(content: ConfluenceContent) {
    if (this.isSpaceExcluded(content.space.key)) {
      return this.spaceExclusionError(content.space.key);
    }
    return handleApiOperation(() => ContentResourceService.createContent(content), 'Error creating content');
  }

  /**
   * Update an existing page in Confluence
   * @param contentId The ID of the content to update
   * @param content The updated content object
   */
  async updateContent(contentId: string, content: ConfluenceContent) {
    if (this.isSpaceExcluded(content.space.key)) {
      return this.spaceExclusionError(content.space.key);
    }
    return handleApiOperation(() => ContentResourceService.update2(contentId, content), 'Error updating content');
  }

  /**
   * Search for spaces by text
   * @param searchText Text to search for in space names or descriptions
   * @param limit Maximum number of results to return
   * @param start Start index for pagination
   * @param expand Optional comma-separated list of properties to expand
   */
  async searchSpaces(
    searchText: string,
    limit?: number,
    start?: number,
    expand?: string,
    excerpt: 'none' | 'highlight' = 'none'
  ) {
    const escapedSearchText = escapeSearchTextForCql(searchText);
    let cql = `type=space AND title ~ "${escapedSearchText}"`;
    const excluded = this.getExcludedSpaces();
    if (excluded.length > 0) {
      const keys = excluded.map(s => `"${escapeCqlKey(s)}"`).join(', ');
      cql += ` AND space.key NOT IN (${keys})`;
    }

    return handleApiOperation(() => SearchService.search1(
      undefined,
      expand,
      undefined,
      (limit ?? this.getPageSize()).toString(),
      start?.toString(),
      excerpt,
      cql
    ), 'Error searching for spaces');
  }

  static validateConfig(): string[] {
    return getMissingConfig();
  }
}

export const confluenceToolSchemas = {
  getContent: {
    contentId: z.string().max(255).describe("Confluence Data Center content ID"),
    expand: z.string().max(500).optional().describe("Comma-separated list of properties to expand"),
    bodyMode: z.enum(['storage', 'text', 'none']).optional().describe("How to return the page body. Defaults to storage for backward compatibility."),
    maxBodyChars: z.number().int().min(1).optional().describe("Maximum number of characters to keep when bodyMode is text")
  },
  searchContent: {
    cql: z.string().max(10000).describe("Confluence Query Language (CQL) search string for Confluence Data Center"),
    limit: z.number().int().min(1).max(500).optional().describe("Maximum number of results to return"),
    start: z.number().int().min(0).optional().describe("Start index for pagination"),
    expand: z.string().max(500).optional().describe("Comma-separated list of properties to expand"),
    excerpt: z.enum(['none', 'highlight']).optional().describe("Excerpt mode for search results. Defaults to none.")
  },
  createContent: {
    title: z.string().max(255).describe("Title of the content"),
    spaceKey: z.string().max(255).describe("Space key where content will be created"),
    type: z.string().max(50).default("page").describe("Content type (page, blogpost, etc)"),
    content: z.string().max(1_000_000).describe("Content body in Confluence Data Center \"storage\" format (confluence XML)"),
    parentId: z.string().max(255).optional().describe("ID of the parent page (if creating a child page)"),
    output: z.enum(['ack', 'full']).optional().describe("Return a compact acknowledgement or the full API response. Defaults to ack.")
  },
  updateContent: {
    contentId: z.string().max(255).describe("ID of the content to update"),
    title: z.string().max(255).optional().describe("New title of the content"),
    content: z.string().max(1_000_000).optional().describe("New content body in Confluence Data Center storage format (XML-based)"),
    version: z.number().int().min(1).describe("New version number (must be incremented)"),
    versionComment: z.string().max(1000).optional().describe("Comment for this version"),
    output: z.enum(['ack', 'full']).optional().describe("Return a compact acknowledgement or the full API response. Defaults to ack.")
  },
  searchSpaces: {
    searchText: z.string().max(1000).describe("Text to search for in Confluence Data Center space names or descriptions. Quotes and backslashes are escaped for CQL; pass the literal search phrase only (do not pre-escape)."),
    limit: z.number().int().min(1).max(500).optional().describe("Maximum number of results to return"),
    start: z.number().int().min(0).optional().describe("Start index for pagination"),
    expand: z.string().max(500).optional().describe("Comma-separated list of properties to expand"),
    excerpt: z.enum(['none', 'highlight']).optional().describe("Excerpt mode for search results. Defaults to none.")
  }
};
