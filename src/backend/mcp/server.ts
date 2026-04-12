import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Container } from "@/backend/container";
import { AitmMcpResourceAdapter } from "./aitm-resource-adapter";

export async function createAitmMcpServer(
  container: Container,
): Promise<McpServer> {
  const server = new McpServer({
    name: "aitm",
    version: "0.1.0",
  });

  const adapter = new AitmMcpResourceAdapter(container);
  const resources = await adapter.listResources();

  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => resource.read(),
    );
  }

  return server;
}
