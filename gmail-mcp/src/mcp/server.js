import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { logger } from "../utils/logger.js";

export async function startMcpServer() {
  const server = new McpServer({
    name: "gmail-mcp-server",
    version: "1.0.0"
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Gmail MCP server started");
}
