#!/usr/bin/env node
/**
 * MCP stdio server exposing the AskUserQuestion tool.
 *
 * Launched by claude-cli.ts as a sidecar via --mcp-config.
 * When Claude calls AskUserQuestion, this server POSTs the question
 * to the aitm API and long-polls until the user answers.
 *
 * Environment variables:
 *   SESSION_ID  – aitm session ID
 *   AITM_URL    – base URL of the aitm server (default: http://localhost:3000)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SESSION_ID = process.env.SESSION_ID;
const AITM_URL = process.env.AITM_URL ?? "http://localhost:3000";

if (!SESSION_ID) {
  process.stderr.write("SESSION_ID environment variable is required\n");
  process.exit(1);
}

const server = new Server(
  { name: "aitm-ask-user-question", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "AskUserQuestion",
      description:
        "Ask the user one or more questions and wait for their response before continuing.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label", "description"],
                  },
                },
              },
              required: ["question", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "AskUserQuestion") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { questions } = request.params.arguments ?? {};
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("questions array is required");
  }

  // Flatten to a single human-readable string, matching the SDK path.
  const questionText = questions
    .map((q) =>
      [
        q.question,
        (q.options ?? [])
          .map((o) => `  - ${o.label}: ${o.description}`)
          .join("\n"),
      ].join("\n"),
    )
    .join("\n\n");

  const response = await fetch(
    `${AITM_URL}/api/sessions/${SESSION_ID}/question`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: questionText }),
      // No client-side timeout — the server holds the connection open
      // until the user submits an answer.
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`aitm returned ${response.status}: ${text}`);
  }

  const { answer } = await response.json();

  // Return answers keyed by question text, matching the SDK convention.
  const answers = Object.fromEntries(
    questions.map((q) => [q.question, answer]),
  );
  return {
    content: [{ type: "text", text: JSON.stringify({ answers }) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
