import { createMcpServer, formatToolResponse } from '@atlassian-dc-mcp/common';
import { ConfluenceService, ConfluenceContent, confluenceToolSchemas } from './confluence-service.js';
import { shapeConfluenceMutationAck } from './confluence-response-mapper.js';

const CONFLUENCE_INSTANCE_TYPE = 'Confluence Data Center edition instance';

export function createConfluenceServer(service: ConfluenceService, version = '0.0.0-test') {
  const server = createMcpServer({ name: 'atlassian-confluence-mcp', version });

  server.tool(
    'confluence_getContent',
    `Get Confluence content by ID from the ${CONFLUENCE_INSTANCE_TYPE}`,
    confluenceToolSchemas.getContent,
    async ({ contentId, expand, bodyMode, maxBodyChars }) => {
      const result = await service.getContent(contentId, expand, bodyMode, maxBodyChars);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'confluence_searchContent',
    `Search for content in ${CONFLUENCE_INSTANCE_TYPE} using CQL`,
    confluenceToolSchemas.searchContent,
    async ({ cql, limit, start, expand, excerpt }) => {
      const result = await service.searchContent(cql, limit, start, expand, excerpt);
      return formatToolResponse(result);
    }
  );

  server.tool(
    'confluence_createContent',
    `Create new content in ${CONFLUENCE_INSTANCE_TYPE}`,
    confluenceToolSchemas.createContent,
    async ({ title, spaceKey, type, content, parentId, output }) => {
      const contentObj: ConfluenceContent = {
        type: type || 'page',
        title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: content,
            representation: 'storage',
          },
        },
      };

      if (parentId) {
        contentObj.ancestors = [{ id: parentId }];
      }

      const result = await service.createContent(contentObj);
      if (result.success && result.data && output !== 'full') {
        return formatToolResponse({ ...result, data: shapeConfluenceMutationAck(result.data) });
      }
      return formatToolResponse(result);
    }
  );

  server.tool(
    'confluence_updateContent',
    `Update existing content in ${CONFLUENCE_INSTANCE_TYPE}`,
    confluenceToolSchemas.updateContent,
    async ({ contentId, title, content, version, versionComment, output }) => {
      const currentContent = await service.getContentRaw(contentId);

      if (!currentContent.success || !currentContent.data) {
        return formatToolResponse({
          success: false,
          error: `Failed to retrieve content with ID ${contentId}: ${currentContent.error || 'Unknown error'}`,
        });
      }

      const contentData = currentContent.data as {
        type: string;
        title: string;
        space: { key: string };
      };

      // Enforce exclusion before any write — prevents reading then silently failing.
      const spaceKey = contentData.space?.key;
      if (spaceKey && service.isSpaceExcluded(spaceKey)) {
        return formatToolResponse(service.spaceExclusionError(spaceKey));
      }

      const updateObj: ConfluenceContent = {
        id: contentId,
        type: contentData.type,
        title: title || contentData.title,
        space: contentData.space,
        version: {
          number: version,
          message: versionComment,
        },
      };

      if (content) {
        updateObj.body = {
          storage: {
            value: content,
            representation: 'storage',
          },
        };
      }

      const result = await service.updateContent(contentId, updateObj);
      if (result.success && result.data && output !== 'full') {
        return formatToolResponse({ ...result, data: shapeConfluenceMutationAck(result.data) });
      }
      return formatToolResponse(result);
    }
  );

  server.tool(
    'confluence_searchSpace',
    `Search for spaces in ${CONFLUENCE_INSTANCE_TYPE}`,
    confluenceToolSchemas.searchSpaces,
    async ({ searchText, limit, start, expand, excerpt }) => {
      const result = await service.searchSpaces(searchText, limit, start, expand, excerpt);
      return formatToolResponse(result);
    }
  );

  return server;
}
