import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getContainer } from "@/backend/container";
import { createAitmMcpServer } from "./server";

export const AITM_MCP_SERVER_NAME = "aitm";
const DEFAULT_AITM_MCP_PORT = "3000";

export async function createClaudeAitmMcpConfig(): Promise<{
  mcpServers: Record<string, McpServerConfig>;
  close: () => Promise<void>;
}> {
  const server = await createAitmMcpServer(getContainer());

  return {
    mcpServers: {
      [AITM_MCP_SERVER_NAME]: {
        type: "sdk",
        name: AITM_MCP_SERVER_NAME,
        instance: server,
      },
    },
    close: async () => {
      await server.close();
    },
  };
}

export function getAitmMcpUrl(env = process.env): string {
  if (env.AITM_MCP_SERVER_URL) return env.AITM_MCP_SERVER_URL;

  const port = env.PORT ?? DEFAULT_AITM_MCP_PORT;
  return `http://127.0.0.1:${port}/api/mcp`;
}

export function getCodexAitmMcpConfig(env = process.env): {
  mcp_servers: Record<string, { url: string }>;
} {
  return {
    mcp_servers: {
      [AITM_MCP_SERVER_NAME]: {
        url: getAitmMcpUrl(env),
      },
    },
  };
}
