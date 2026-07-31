import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config, ToolError } from "./config.ts";
import { TOOLS, TOOLS_BY_NAME } from "./tools.ts";

const server = new Server(
  { name: "obsidian", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS_BY_NAME.get(request.params.name);
  if (!tool) {
    return errorResult(
      `unknown tool "${request.params.name}". Available: ${TOOLS.map((t) => t.name).join(", ")}.`,
    );
  }
  try {
    const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    // ToolError messages are written to tell the model what to do differently;
    // anything else is a real fault and is reported verbatim.
    const message = error instanceof ToolError ? error.message : String((error as Error)?.message ?? error);
    return errorResult(message);
  }
});

function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function main(): Promise<void> {
  // Fail loudly at startup rather than on the first tool call.
  const cfg = config();
  process.stderr.write(`obsidian-mcp: vault=${cfg.vaultRoot} tz=${cfg.timezone} git=${cfg.gitEnabled}\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`obsidian-mcp failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
