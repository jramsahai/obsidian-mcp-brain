// Converts the server's own TOOLS array (server/src/tools.ts) into the
// OpenAI chat-completions `tools` shape, named with the `obsidian__` prefix
// exactly as the skills spell them. Reuses tools.ts's schemas rather than
// restating them, so a schema change here cannot drift from the real tools.

import { TOOLS } from "../src/tools.ts";

export const OBSIDIAN_PREFIX = "obsidian__";

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function buildOpenAITools(): OpenAITool[] {
  return TOOLS.map((t) => ({
    type: "function",
    function: {
      name: `${OBSIDIAN_PREFIX}${t.name}`,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/** "obsidian__task_add" -> "task_add"; passes through a name with no prefix. */
export function stripPrefix(name: string): string {
  return name.startsWith(OBSIDIAN_PREFIX) ? name.slice(OBSIDIAN_PREFIX.length) : name;
}
