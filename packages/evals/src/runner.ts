import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EvalRun, type EvalTaskResult } from "@protocolfoundry/core";

/** One realistic task an agent should be able to complete via the server. */
export interface EvalTask {
  id: string;
  description: string;
  /** The user request given to the agent. */
  prompt: string;
  /** Tools the agent is expected to call (subset check, order-insensitive). */
  expectedTools: string[];
  /** Case-insensitive regex the agent's final answer must match. */
  successPattern: string;
}

export interface EvalSuite {
  name: string;
  tasks: EvalTask[];
}

const EvalSuiteSchema = z.object({
  name: z.string().min(1),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string(),
        prompt: z.string().min(1),
        expectedTools: z.array(z.string()),
        successPattern: z.string().min(1),
      }),
    )
    .min(1),
});

/** Validate untrusted JSON (file upload, pasted form data) into an EvalSuite. */
export function parseEvalSuite(raw: unknown): EvalSuite {
  const suite = EvalSuiteSchema.parse(
    typeof raw === "string" ? JSON.parse(raw) : raw,
  );
  for (const task of suite.tasks) new RegExp(task.successPattern); // throws on bad regex
  return suite;
}

export interface EvalEndpoint {
  url: string;
  apiKey?: string;
}

/** One agent turn: what the model said and which tools it wants to call. */
export interface AgentTurn {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Pluggable agent-model boundary: given the transcript and available tools,
 * produce the next turn. Real implementation is createAnthropicAgent; tests
 * inject scripted fakes so the harness is verifiable without an API key.
 */
export interface AgentModel {
  readonly model: string;
  turn(
    messages: Anthropic.MessageParam[],
    tools: AgentToolDefinition[],
  ): Promise<AgentTurn>;
}

const AGENT_SYSTEM_PROMPT =
  "You are an autonomous agent completing a task using the available tools. " +
  "Use tools as needed, then state the final outcome plainly, including any ids or values produced.";

/** Claude-backed agent loop participant. Requires ANTHROPIC_API_KEY. */
export function createAnthropicAgent(
  model = "claude-opus-4-8",
  options: { adaptiveThinking?: boolean } = {},
): AgentModel {
  const client = new Anthropic();
  const adaptive = options.adaptiveThinking ?? true;
  return {
    model,
    async turn(messages, tools) {
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        ...(adaptive ? { thinking: { type: "adaptive" as const } } : {}),
        system: AGENT_SYSTEM_PROMPT,
        messages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
        })),
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));
      // Feed the full content back so tool_use blocks are preserved.
      messages.push({ role: "assistant", content: response.content });
      return {
        text,
        toolCalls,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

async function connectMcp(endpoint: EvalEndpoint): Promise<Client> {
  const client = new Client({ name: "protocolfoundry-evals", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: endpoint.apiKey
        ? { headers: { Authorization: `Bearer ${endpoint.apiKey}` } }
        : {},
    }),
  );
  return client;
}

export interface RunOptions {
  /** Max agent turns per task before declaring failure. */
  maxSteps?: number;
  /**
   * Called after each task finishes — progress reporting for long runs
   * (e.g. the dashboard job runner). Awaited, so it may persist state.
   */
  onResult?: (
    result: EvalTaskResult,
    completed: number,
    total: number,
  ) => void | Promise<void>;
}

async function runTask(
  task: EvalTask,
  endpoint: EvalEndpoint,
  agent: AgentModel,
  maxSteps: number,
): Promise<EvalTaskResult> {
  const mcp = await connectMcp(endpoint);
  try {
    const { tools } = await mcp.listTools();
    const agentTools: AgentToolDefinition[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: task.prompt }];
    const toolsCalled: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let finalText = "";
    let failureReason: string | undefined;

    while (steps < maxSteps) {
      steps += 1;
      const turn = await agent.turn(messages, agentTools);
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      finalText = turn.text || finalText;

      if (turn.toolCalls.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of turn.toolCalls) {
        toolsCalled.push(call.name);
        try {
          const result = await mcp.callTool({ name: call.name, arguments: call.input });
          const content = result.content as Array<{ type: string; text?: string }>;
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: content?.[0]?.text ?? "",
            is_error: result.isError === true,
          });
        } catch (error) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    if (steps >= maxSteps) failureReason = `Exceeded max steps (${maxSteps})`;

    const completed =
      !failureReason && new RegExp(task.successPattern, "i").test(finalText);
    if (!completed && !failureReason) {
      failureReason = `Final answer did not match /${task.successPattern}/i`;
    }
    const toolSelectionCorrect = task.expectedTools.every((t) => toolsCalled.includes(t));

    return {
      taskId: task.id,
      description: task.description,
      completed,
      toolSelectionCorrect,
      steps,
      inputTokens,
      outputTokens,
      ...(completed ? {} : { failureReason }),
    };
  } finally {
    await mcp.close();
  }
}

/** Run a full suite against a hosted MCP endpoint and produce an EvalRun. */
export async function runEvalSuite(
  suite: EvalSuite,
  endpoint: EvalEndpoint,
  agent: AgentModel,
  manifestRef: string,
  projectId: string,
  options: RunOptions = {},
): Promise<EvalRun> {
  const maxSteps = options.maxSteps ?? 10;
  const results: EvalTaskResult[] = [];
  for (const task of suite.tasks) {
    const result = await runTask(task, endpoint, agent, maxSteps);
    results.push(result);
    await options.onResult?.(result, results.length, suite.tasks.length);
  }
  const completionRate =
    results.filter((r) => r.completed).length / Math.max(results.length, 1);
  const selectionAccuracy =
    results.filter((r) => r.toolSelectionCorrect).length / Math.max(results.length, 1);

  return EvalRun.parse({
    id: randomUUID(),
    projectId,
    manifestRef,
    agentModel: agent.model,
    results,
    taskCompletionRate: completionRate,
    toolSelectionAccuracy: selectionAccuracy,
    ranAt: new Date().toISOString(),
  });
}
