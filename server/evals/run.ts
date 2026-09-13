#!/usr/bin/env node
// Behavioral evals runner. Given a capture, does the model call the right
// tools with the right arguments? See README.md "Behavioral evals".
//
// Usage:
//   node evals/run.ts               run every scenario against a model
//   node evals/run.ts --only NAME   run just one scenario
//   node evals/run.ts --dry-run     validate scenarios, call no model
//
// Env: EVAL_BASE_URL (default http://127.0.0.1:8080/v1), EVAL_MODEL
// (required unless --dry-run), EVAL_API_KEY (optional, sent as Bearer).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS_BY_NAME } from "../src/tools.ts";
import { cleanupVault, useVault } from "../test/helpers.ts";
import { withFixedNow } from "./fixed-now.ts";
import { buildSystemPrompt } from "./prompt.ts";
import {
  argsMatch,
  compilePattern,
  DEFAULT_MAX_STEPS,
  loadScenarios,
  SCENARIOS_DIR,
  type ExpectCall,
  type Scenario,
} from "./scenario.ts";
import { buildOpenAITools, stripPrefix, type OpenAITool } from "./tools-openai.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface RecordedCall {
  tool: string;
  args: Record<string, unknown>;
}

interface ScenarioResult {
  name: string;
  file: string;
  pass: boolean;
  steps: number;
  calls: RecordedCall[];
  mismatch: string | null;
}

// ------------------------------------------------------------- chat messages

type ChatMessage = Record<string, unknown>;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ModelOpts {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

async function chatCompletion(
  opts: ModelOpts,
  messages: ChatMessage[],
  tools: OpenAITool[],
): Promise<ChatMessage> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: opts.model, messages, tools, tool_choice: "auto" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} responded ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: { message?: ChatMessage }[] };
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error(`${url} returned no choices[0].message: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return message;
}

// -------------------------------------------------------------- one scenario

async function runScenario(scenario: Scenario, modelOpts: ModelOpts, tools: OpenAITool[]): Promise<ScenarioResult> {
  const root = useVault();
  const calls: RecordedCall[] = [];
  let steps = 0;
  try {
    await withFixedNow(scenario.today, async () => {
      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(scenario.skills) },
        { role: "user", content: scenario.user },
      ];
      const maxSteps = scenario.max_steps ?? DEFAULT_MAX_STEPS;

      for (steps = 0; steps < maxSteps; steps++) {
        const message = await chatCompletion(modelOpts, messages, tools);
        messages.push(message);
        const toolCalls = (message.tool_calls as ToolCall[] | undefined) ?? [];
        if (toolCalls.length === 0) break;

        for (const tc of toolCalls) {
          const name = stripPrefix(tc.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            // An unparseable arguments string is reported back to the model,
            // the same way a real host would, rather than crashing the run.
          }
          calls.push({ tool: name, args });

          const tool = TOOLS_BY_NAME.get(name);
          let content: string;
          if (!tool) {
            content = `unknown tool "${tc.function.name}". Available: ${[...TOOLS_BY_NAME.keys()]
              .map((n) => `obsidian__${n}`)
              .join(", ")}.`;
          } else {
            try {
              content = JSON.stringify(tool.handler(args));
            } catch (error) {
              content = (error as Error).message;
            }
          }
          messages.push({ role: "tool", tool_call_id: tc.id, content });
        }
      }
    });

    const mismatch = evaluateScenario(scenario, calls, root);
    return { name: scenario.name, file: scenario.file, pass: mismatch === null, steps, calls, mismatch };
  } finally {
    cleanupVault();
  }
}

function describeExpect(expect: ExpectCall): string {
  return expect.args ? `${expect.tool} ${JSON.stringify(expect.args)}` : expect.tool;
}

/** The first thing wrong with the run, or null when every assertion holds. */
function evaluateScenario(scenario: Scenario, calls: RecordedCall[], root: string): string | null {
  let cursor = 0;
  for (const expect of scenario.expect_calls) {
    const searchFrom = expect.ordered ? cursor : 0;
    const idx = calls.findIndex(
      (c, i) => i >= searchFrom && c.tool === expect.tool && argsMatch(expect.args, c.args),
    );
    if (idx === -1) return `missing expected call: ${describeExpect(expect)}`;
    if (expect.ordered) cursor = idx + 1;
  }

  if (scenario.forbid_calls) {
    const hit = calls.find((c) => scenario.forbid_calls!.includes(c.tool));
    if (hit) return `forbidden call made: ${hit.tool} ${JSON.stringify(hit.args)}`;
  }

  if (scenario.expect_files) {
    for (const file of scenario.expect_files) {
      let content: string;
      try {
        content = readFileSync(join(root, file.path), "utf8");
      } catch {
        return `expected file not found: ${file.path}`;
      }
      for (const pattern of file.matches) {
        if (!compilePattern(pattern).test(content)) {
          return `${file.path} does not match ${pattern}`;
        }
      }
    }
  }

  return null;
}

// ------------------------------------------------------------------ CLI/main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex !== -1 ? argv[onlyIndex + 1] : undefined;

  let scenarios: Scenario[];
  try {
    scenarios = loadScenarios();
  } catch (error) {
    console.error(`scenario validation failed: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
  if (scenarios.length === 0) {
    console.error(`no scenarios found in ${SCENARIOS_DIR}`);
    process.exit(1);
    return;
  }

  if (only) {
    scenarios = scenarios.filter((s) => s.name === only);
    if (scenarios.length === 0) {
      console.error(`no scenario named "${only}".`);
      process.exit(1);
      return;
    }
  }

  const tools = buildOpenAITools();

  if (dryRun) {
    for (const s of scenarios) {
      const prompt = buildSystemPrompt(s.skills);
      console.log(
        `DRY-RUN ${s.name}: system_prompt_chars=${prompt.length} tools=${tools.length} skills=[second-brain, ${s.skills.join(", ")}]`,
      );
    }
    console.log(`${scenarios.length} scenario(s) valid. No model was called.`);
    return;
  }

  const baseUrl = process.env.EVAL_BASE_URL || "http://127.0.0.1:8080/v1";
  const model = process.env.EVAL_MODEL;
  const apiKey = process.env.EVAL_API_KEY;
  if (!model) {
    console.error(
      "EVAL_MODEL is required (the model name your OpenAI-compatible endpoint serves). " +
        "Set EVAL_BASE_URL if it is not a local llama-server on http://127.0.0.1:8080/v1. " +
        "Pass --dry-run to validate scenarios without calling a model.",
    );
    process.exit(1);
    return;
  }

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`${scenario.name}... `);
    try {
      const result = await runScenario(scenario, { baseUrl, model, apiKey }, tools);
      results.push(result);
      console.log(
        `${result.pass ? "PASS" : "FAIL"} (steps=${result.steps}${result.mismatch ? `; ${result.mismatch}` : ""})`,
      );
    } catch (error) {
      const result: ScenarioResult = {
        name: scenario.name,
        file: scenario.file,
        pass: false,
        steps: 0,
        calls: [],
        mismatch: `runner error: ${(error as Error).message}`,
      };
      results.push(result);
      console.log(`FAIL (${result.mismatch})`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios passed.`);

  writeFileSync(
    join(HERE, "last-run.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), baseUrl, model, results }, null, 2),
  );

  if (passed !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
