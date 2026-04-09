import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
export * from './api-error-handler.js'
export * from './runtime-config.js';

// Helper function to format tool responses
export const formatToolResponse = (result: unknown) => ({
  content: [{
    type: 'text' as const,
    text: JSON.stringify(result)
  }]
});

// Error handler helper
export const handleError = (error: Error) => {
  console.error("Server error:", error);
  process.exit(1);
};

// Create a base server setup function
export function createMcpServer(options: {
  name: string;
  version: string;
}) {
  return new McpServer({
    name: options.name,
    version: options.version
  });
}

export async function connectServer(server: McpServer, transport?: Transport) {
  const t = transport ?? new StdioServerTransport();
  await server.connect(t);
  return server;
}
