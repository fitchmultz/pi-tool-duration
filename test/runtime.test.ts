import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const hostDir =
  process.env.PI_HOST_INDEX !== undefined
    ? resolve(dirname(process.env.PI_HOST_INDEX), "..")
    : resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const hostPackage: unknown = JSON.parse(readFileSync(join(hostDir, "package.json"), "utf8"));
assert.ok(
  isRecord(hostPackage) && isRecord(hostPackage.bin) && typeof hostPackage.bin.pi === "string",
  "host package must declare a pi binary",
);
const bundledCli = join(hostDir, hostPackage.bin.pi);
const piCli = process.env.PI_HOST_CLI ?? bundledCli;
assert.equal(
  realpathSync(piCli),
  realpathSync(bundledCli),
  "CLI must belong to the installed selected host",
);
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
  assert.equal(realpathSync(hostDir), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
  assert.equal(hostPackage.version, process.env.PI_COMPAT_EXPECTED_VERSION);
}
const extension = resolve(
  process.env.PI_TOOL_DURATION_TEST_EXTENSION ?? "extensions/tool-duration/index.ts",
);
const fixture = resolve("test/fixtures/runtime-extension.ts");
const MAX_CAPTURE_CHARS = 1_000_000;

type FixtureCall = { name: string; arguments: { action: string } };
type WireTool = { name: string };
type WireOutputPart = { type?: string; text?: string; detail?: string; image_url?: string };
type WireItem = {
  type: string;
  role?: string;
  tools?: WireTool[];
  call_id?: string;
  output?: string | WireOutputPart[];
};
type WireBody = { model?: string; stream?: boolean; input: WireItem[]; tools?: WireTool[] };
type CapturedRequest = { method: string; url: string; body: WireBody };
type CapturedBlock = { type: string; text?: string; mimeType?: string; data?: string };
type CapturedMessage = {
  role?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp?: number;
  details?: unknown;
  content: string | CapturedBlock[];
  customType?: string;
};
type CapturedEvent = {
  type: string;
  message?: CapturedMessage;
  result?: { content: CapturedBlock[]; details?: unknown };
};

type RunPiOptions = {
  calls?: FixtureCall[];
  threshold?: string;
  flag?: string;
  reload?: boolean;
  summarize?: "prefix" | "history";
  replaceTimestamp?: boolean;
};

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isCapturedRequest(value: unknown): value is CapturedRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("method" in value) || typeof value.method !== "string") {
    return false;
  }
  if (!("url" in value) || typeof value.url !== "string") {
    return false;
  }
  if (!("body" in value) || typeof value.body !== "object" || value.body === null) {
    return false;
  }
  return "input" in value.body && Array.isArray(value.body.input);
}

function isCapturedEvent(value: unknown): value is CapturedEvent {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

async function isolatedEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-duration-test-"));
  return {
    root,
    env: {
      HOME: root,
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
      USER: "pi-test",
      LANG: "C",
      CI: "1",
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      ...overrides,
    } satisfies NodeJS.ProcessEnv,
  };
}

function appendCaptured(current: string, chunk: string): string {
  return current + chunk.slice(0, MAX_CAPTURE_CHARS - current.length);
}

async function runProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [piCli, ...args], {
    cwd: resolve("."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data: string) => {
    stdout = appendCaptured(stdout, data);
  });
  child.stderr.setEncoding("utf8").on("data", (data: string) => {
    stderr = appendCaptured(stderr, data);
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, 20_000);
  try {
    const closed = await new Promise<[number | null, NodeJS.Signals | null]>((closeDone) => {
      child.once("close", (code, signal) => {
        closeDone([code, signal]);
      });
    });
    return { code: closed[0], signal: closed[1], stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

const reasoningItem = {
  type: "reasoning",
  id: "rs_fixture",
  summary: [],
  encrypted_content: "opaque-fixture-reasoning",
};

function sendScriptedResponse(
  response: ServerResponse,
  calls: FixtureCall[] | undefined,
  responseId: string,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const output = calls
    ? [
        reasoningItem,
        ...calls.map((call, index) => ({
          type: "function_call",
          id: `fc_${index}`,
          call_id: `call_${index}`,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
          status: "completed",
        })),
      ]
    : [
        {
          type: "message",
          id: "msg_done",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "done", annotations: [] }],
        },
      ];
  send({ type: "response.created", response: { id: responseId } });
  for (const [output_index, item] of output.entries()) {
    send({ type: "response.output_item.added", output_index, item });
    send({ type: "response.output_item.done", output_index, item });
  }
  send({
    type: "response.completed",
    response: {
      id: responseId,
      status: "completed",
      output,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  response.end();
}

async function handleModelRequest(
  request: IncomingMessage,
  response: ServerResponse,
  calls: FixtureCall[] | undefined,
  requests: CapturedRequest[],
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    assert.ok(chunk instanceof Buffer, "request chunks must be Buffers");
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const candidate = { method: request.method ?? "", url: request.url ?? "", body: parsed };
  assert.ok(isCapturedRequest(candidate), "captured request must match the Responses wire shape");
  requests.push(candidate);
  sendScriptedResponse(
    response,
    requests.length === 1 ? calls : undefined,
    `resp_fixture_${requests.length}`,
  );
}

async function runPi(options: RunPiOptions) {
  const { calls, threshold, flag, reload = false, summarize, replaceTimestamp = false } = options;
  const requests: CapturedRequest[] = [];
  let handlerFailure: Error | undefined;
  const server = createServer((request, response) => {
    handleModelRequest(request, response, calls, requests).catch((error: unknown) => {
      handlerFailure = error instanceof Error ? error : new Error(String(error));
      response.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server must be bound");
  const { port } = address;
  const isolation = await isolatedEnvironment({
    ...(threshold === undefined ? {} : { PI_TOOL_DURATION_THRESHOLD_MS: threshold }),
    PI_TOOL_DURATION_TEST_PORT: String(port),
    PI_TOOL_DURATION_TEST_REPLACE_TIMESTAMP: String(replaceTimestamp),
  });

  if (summarize !== undefined) {
    await mkdir(join(isolation.root, "agent"), { recursive: true });
    await writeFile(
      join(isolation.root, "agent/settings.json"),
      JSON.stringify({
        compaction: {
          enabled: false,
          reserveTokens: 1024,
          keepRecentTokens: summarize === "history" ? 128 : 1,
        },
      }),
    );
  }

  const args = [
    "--no-extensions",
    "--extension",
    extension,
    "--extension",
    fixture,
    "--no-builtin-tools",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--offline",
    "--approve",
    "--no-session",
    "--mode",
    "json",
    "--model",
    "duration-test/scripted",
    "--thinking",
    "low",
  ];
  if (flag !== undefined) {
    args.push("--tool-duration-threshold-ms", flag);
  }
  args.push("-p", "Run the scripted test scenario.");
  if (reload) {
    args.push("/duration-test-reload", "Continue after reloading.");
  }
  // A full second turn puts the cut at its user message instead of splitting the first turn.
  if (summarize === "history") {
    args.push(`New turn: ${"context ".repeat(100)}`);
  }
  if (summarize !== undefined) {
    args.push("/duration-test-compact");
  }

  try {
    const { code, signal, stdout, stderr } = await runProcess(args, isolation.env);
    assert.ok(
      handlerFailure === undefined,
      `model stub request handler failed: ${String(handlerFailure)}`,
    );
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.equal(
      requests.length,
      2 + Number(reload) + Number(Boolean(summarize)) + Number(summarize === "history"),
      stderr,
    );
    for (const request of requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.body.model, "scripted");
      assert.equal(request.body.stream, true);
    }
    const [initialRequest] = requests;
    assert.ok(initialRequest, "expected an initial request");
    const initial = initialRequest.body;
    // Both hosts anchor even the initial declaration in additional_tools so later redefinitions preserve the prefix.
    assert.equal(initial.tools, undefined);
    const first = initial.input.at(0);
    assert.ok(first, "expected an initial input item");
    assert.ok(first.tools, "additional_tools items must carry tools");
    assert.equal(first.type, "additional_tools");
    assert.equal(first.role, "developer");
    assert.deepEqual(
      first.tools.map((tool) => tool.name),
      ["duration_fixture"],
    );
    assert.equal(initial.input.filter((item) => item.type === "additional_tools").length, 1);
    const followUp = requests.at(1);
    assert.ok(followUp, "expected a follow-up request");
    assert.ok(followUp.body.input.some((message) => message.type === "function_call_output"));

    const events = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parsed: unknown = JSON.parse(line);
        assert.ok(isCapturedEvent(parsed), `unexpected json line: ${line}`);
        return parsed;
      });
    return { stderr, requests, events };
  } finally {
    if (server.listening) {
      await new Promise<void>((settled) => {
        server.close(() => {
          settled();
        });
      });
    }
    await rm(isolation.root, { recursive: true, force: true });
  }
}

function toolMessages(events: CapturedEvent[]): CapturedMessage[] {
  return events
    .filter((event) => event.type === "message_end" && event.message?.role === "toolResult")
    .map((event) => {
      const message = event.message;
      assert.ok(message !== undefined);
      return message;
    });
}

function textBlocks(message: { content: string | CapturedBlock[] }): (string | undefined)[] {
  assert.ok(Array.isArray(message.content), "tool results must carry block content");
  return message.content.filter((item) => item.type === "text").map((item) => item.text);
}

function modelToolOutputs(request: CapturedRequest): (string | WireOutputPart[] | undefined)[] {
  return request.body.input
    .filter((item) => item.type === "function_call_output")
    .map((item) => item.output);
}

function wireOutput(requests: CapturedRequest[], requestIndex: number, outputIndex = 0): string {
  const request = requests.at(requestIndex);
  assert.ok(request, `expected request ${requestIndex}`);
  const output = modelToolOutputs(request).at(outputIndex);
  assert.ok(
    output !== undefined && typeof output === "string",
    "expected a text function_call_output",
  );
  return output;
}

function durationSeconds(text: string): number {
  const match = /(?:^|\n)\[host tool-call elapsed: (\d+\.\d)s\]$/.exec(text);
  assert.ok(match, `invalid duration marker: ${text}`);
  return Number(match[1]);
}

nodeTest("keeps the long threshold flag readable in help output", async () => {
  const isolation = await isolatedEnvironment();
  try {
    const { code, stdout, stderr } = await runProcess(
      ["--no-extensions", "--extension", extension, "--help"],
      isolation.env,
    );
    assert.equal(code, 0, stderr);
    assert.match(stdout, /--tool-duration-threshold-ms <value>\s+Minimum/);
  } finally {
    await rm(isolation.root, { recursive: true, force: true });
  }
});

nodeTest("applies the threshold independently to parallel tools", async () => {
  const { events, requests } = await runPi({
    calls: [
      { name: "duration_fixture", arguments: { action: "fast" } },
      { name: "duration_fixture", arguments: { action: "slow" } },
    ],
    threshold: "500",
  });

  const [fast, slow] = toolMessages(events);
  assert.ok(fast && slow, "expected both tool results");
  assert.deepEqual(textBlocks(fast), ["fast-ok"]);
  assert.deepEqual(textBlocks(slow), ["slow-ok"]);
  const fastOutput = wireOutput(requests, 1, 0);
  const slowOutput = wireOutput(requests, 1, 1);
  assert.equal(fastOutput, "fast-ok");
  assert.ok(durationSeconds(slowOutput) >= 0.5);
  assert.deepEqual(slow.details, { status: 201 });
});

nodeTest("ignores an invalid CLI threshold and uses the environment", async () => {
  const { requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
    threshold: "0",
    flag: "not-a-number",
  });

  durationSeconds(wireOutput(requests, 1));
});

nodeTest("lets the CLI threshold override the environment", async () => {
  const calls = [{ name: "duration_fixture", arguments: { action: "fast" } }];
  const suppressed = await runPi({ calls, threshold: "0", flag: "60000" });
  const [suppressedMessage] = toolMessages(suppressed.events);
  assert.ok(suppressedMessage, "expected a tool result");
  assert.deepEqual(textBlocks(suppressedMessage), ["fast-ok"]);
  assert.deepEqual([wireOutput(suppressed.requests, 1)], ["fast-ok"]);

  const annotated = await runPi({ calls, threshold: "60000", flag: "0" });
  durationSeconds(wireOutput(annotated.requests, 1));
});

nodeTest("measures slow tool output that looks like a duration marker", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "marker" } }],
    threshold: "50",
  });

  const [message] = toolMessages(events);
  assert.ok(message, "expected a tool result");
  const texts = textBlocks(message);
  assert.deepEqual(texts, ["[host tool-call elapsed: 9.9s]"]);
  const output = wireOutput(requests, 1);
  assert.ok(output.startsWith("[host tool-call elapsed: 9.9s]\n"));
  const occurrences = output.match(/\[host tool-call elapsed:/g);
  assert.ok(occurrences, "expected duration markers");
  assert.equal(occurrences.length, 2);
  durationSeconds(output);
});

nodeTest("times slower tools by default without duplicating tool execution output", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "slow" } }],
  });

  const executionEnd = events.find((event) => event.type === "tool_execution_end");
  assert.ok(executionEnd && executionEnd.result, "expected a tool_execution_end event");
  assert.deepEqual(textBlocks(executionEnd.result), ["slow-ok"]);

  const [message] = toolMessages(events);
  assert.ok(message, "expected a tool result");
  assert.deepEqual(textBlocks(message), ["slow-ok"]);

  const outboundTool = wireOutputRequest(requests, 1).body.input.find(
    (item) => item.type === "function_call_output",
  );
  assert.ok(outboundTool, "expected a function_call_output item");
  assert.match(JSON.stringify(outboundTool), /\[host tool-call elapsed: \d+\.\ds\]/);
});

function wireOutputRequest(requests: CapturedRequest[], index: number): CapturedRequest {
  const request = requests.at(index);
  assert.ok(request, `expected request ${index}`);
  return request;
}

nodeTest(
  "preserves the native Responses prefix when a timed tool activates another tool",
  async () => {
    const { events, requests } = await runPi({
      calls: [{ name: "duration_fixture", arguments: { action: "load" } }],
      threshold: "0",
    });
    const initial = wireOutputRequest(requests, 0).body;
    const next = wireOutputRequest(requests, 1).body;
    assert.deepEqual(
      next.tools,
      initial.tools,
      "initial tool declarations must not be hoisted or replaced",
    );
    assert.deepEqual(
      next.input.slice(0, initial.input.length),
      initial.input,
      "the prompt prefix must stay byte-for-byte stable",
    );
    const resultIndex = next.input.findIndex((item) => item.type === "function_call_output");
    const additionIndex = next.input.findIndex(
      (item, index) => index >= initial.input.length && item.type === "additional_tools",
    );
    assert.equal(
      next.input.filter((item) => item.type === "additional_tools").length,
      initial.input.filter((item) => item.type === "additional_tools").length + 1,
    );
    assert.ok(additionIndex > resultIndex, "new tools belong inline after the timed result");
    const additionItem = next.input.at(additionIndex);
    assert.ok(additionItem && additionItem.tools, "expected the additional_tools item");
    assert.deepEqual(
      additionItem.tools.map((tool) => tool.name),
      ["duration_extra"],
    );
    assert.match(
      JSON.stringify(next.input.slice(additionIndex + 1)),
      /Extra fixture available after loading/,
    );
    assert.deepEqual(
      next.input.find((item) => item.type === "reasoning"),
      reasoningItem,
    );
    const call = next.input.find((item) => item.type === "function_call");
    const resultItem = next.input.at(resultIndex);
    assert.ok(call && resultItem, "expected function_call and function_call_output items");
    assert.equal(call.call_id, resultItem.call_id);
    const [message] = toolMessages(events);
    assert.ok(message, "expected a tool result");
    assert.equal(message.toolCallId, "call_0|fc_0");
    assert.deepEqual(message.content, [
      { type: "text", text: "loaded-extra" },
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      },
    ]);
    assert.deepEqual(message.details, { status: 201 });
    const executionEnd = events.find((event) => event.type === "tool_execution_end");
    assert.ok(executionEnd && executionEnd.result, "expected a tool_execution_end event");
    assert.deepEqual(executionEnd.result.content, message.content);
    assert.ok(Array.isArray(resultItem.output), "expected structured function output parts");
    assert.equal(resultItem.output.length, 2);
    const firstOutput = resultItem.output.at(0);
    assert.ok(firstOutput && firstOutput.text !== undefined, "expected a text output part");
    assert.ok(firstOutput.text.startsWith("loaded-extra\n"));
    durationSeconds(firstOutput.text);
    assert.deepEqual(resultItem.output.at(1), {
      type: "input_image",
      detail: "auto",
      image_url:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    });
    assert.ok(
      !JSON.stringify(next).includes('"status":201'),
      "raw tool details must stay off the wire",
    );
  },
);

nodeTest(
  "retains timing when a later message_end handler replaces the result timestamp",
  async () => {
    const { events, requests } = await runPi({
      calls: [{ name: "duration_fixture", arguments: { action: "status" } }],
      replaceTimestamp: true,
      threshold: "0",
    });
    const [message] = toolMessages(events);
    assert.ok(message, "expected a tool result");
    assert.equal(message.timestamp, 1);
    assert.deepEqual(textBlocks(message), ["status-ok"]);
    assert.deepEqual(message.details, { status: 200 });
    const executionEnd = events.find((event) => event.type === "tool_execution_end");
    assert.ok(executionEnd && executionEnd.result, "expected a tool_execution_end event");
    assert.deepEqual(executionEnd.result, {
      content: [{ type: "text", text: "status-ok" }],
      details: { status: 200 },
    });
    const output = wireOutput(requests, 1);
    assert.ok(output.startsWith("status-ok\n"));
    durationSeconds(output);
  },
);

nodeTest(
  "retains model-only timing after reloading extensions without duplicating it",
  async () => {
    const { events, requests } = await runPi({
      calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
      threshold: "0",
      reload: true,
    });

    const [message] = toolMessages(events);
    assert.ok(message, "expected a tool result");
    assert.deepEqual(textBlocks(message), ["fast-ok"]);
    const before = wireOutput(requests, 1);
    const after = wireOutput(requests, 2);
    durationSeconds(before);
    assert.equal(after, before);
    const occurrences = after.match(/\[host tool-call elapsed:/g);
    assert.ok(occurrences, "expected duration markers");
    assert.equal(occurrences.length, 1);
  },
);

for (const summarize of ["prefix", "history"] as const) {
  for (const action of ["fast", "long"] as const) {
    nodeTest(
      `keeps ${action} output timing in ${summarize} summaries without changing recorded tool output`,
      async () => {
        const originalText = action === "long" ? "long-output ".repeat(400) : "fast-ok";
        const { events, requests, stderr } = await runPi({
          calls: [{ name: "duration_fixture", arguments: { action } }],
          threshold: "0",
          summarize,
        });
        assert.doesNotMatch(stderr, /Extension error/);
        const [message] = toolMessages(events);
        assert.ok(message, "expected a tool result");
        assert.deepEqual(textBlocks(message), [originalText]);
        assert.deepEqual(message.details, action === "long" ? { status: 200 } : undefined);
        const executionEnd = events.find((event) => event.type === "tool_execution_end");
        assert.ok(executionEnd && executionEnd.result, "expected a tool_execution_end event");
        assert.deepEqual(textBlocks(executionEnd.result), [originalText]);
        const output = wireOutput(requests, 1);
        durationSeconds(output);
        const durations = output.match(/\[host tool-call elapsed: \d+\.\ds\]/g);
        assert.ok(durations, "expected duration markers");
        assert.equal(durations.length, 1);
        const duration = durations.at(0);
        assert.ok(duration !== undefined, "expected a duration marker");
        assert.equal(output, `${originalText}\n${duration}`);
        const lastRequest = requests.at(-1);
        assert.ok(lastRequest, "expected a summarization request");
        const summaryInput = JSON.stringify(lastRequest.body.input);
        assert.ok(summaryInput.includes(originalText.slice(0, 100)), summaryInput);
        if (action === "long") {
          assert.match(summaryInput, /more characters truncated/);
          assert.ok(
            !summaryInput.includes(originalText),
            "native summarization must truncate the long output",
          );
        }
        const snapshotEvent = events.find(
          (event) =>
            event.type === "message_end" && event.message?.customType === "duration-test-recorded",
        );
        assert.ok(
          snapshotEvent &&
            snapshotEvent.message &&
            typeof snapshotEvent.message.content === "string",
          "expected the recorded snapshot message",
        );
        const journal: unknown = JSON.parse(snapshotEvent.message.content);
        assert.ok(isJsonArray(journal), "snapshot content must be a session journal");
        const recordedEntry = journal.find(
          (entry) =>
            isRecord(entry) &&
            entry.type === "message" &&
            isRecord(entry.message) &&
            entry.message.role === "toolResult",
        );
        assert.ok(
          recordedEntry !== undefined && isRecord(recordedEntry) && isRecord(recordedEntry.message),
          "expected the recorded tool result",
        );
        assert.deepEqual(recordedEntry.message, message);
        assert.ok(summaryInput.includes(duration), "summarizer must receive the original timing");
        const occurrences = summaryInput.match(/\[host tool-call elapsed:/g);
        assert.ok(occurrences, "expected duration markers");
        assert.equal(occurrences.length, 1);
      },
    );
  }
}

nodeTest("annotates failures blocked during tool preflight", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "blocked" } }],
    threshold: "60000",
  });

  const [message] = toolMessages(events);
  assert.ok(message, "expected a tool result");
  assert.equal(message.isError, true);
  const blocked = textBlocks(message).at(0);
  assert.ok(blocked !== undefined, "expected blocked text");
  assert.match(blocked, /fixture blocked/);
  durationSeconds(wireOutput(requests, 1));
});

nodeTest("normalizes missing tool content before appending a duration", async () => {
  const { events, requests, stderr } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "no_content" } }],
    threshold: "0",
  });

  assert.doesNotMatch(stderr, /Extension error/);
  const [message] = toolMessages(events);
  assert.ok(message, "expected a tool result");
  assert.deepEqual(textBlocks(message), []);
  durationSeconds(wireOutput(requests, 1));
});

nodeTest("only failed fast results bypass a high threshold", async () => {
  const { events, requests } = await runPi({
    threshold: "60000",
    calls: [
      { name: "duration_fixture", arguments: { action: "exit_text" } },
      { name: "duration_fixture", arguments: { action: "status" } },
      { name: "duration_fixture", arguments: { action: "error" } },
    ],
  });

  const [exitText, status, error] = toolMessages(events);
  assert.ok(exitText && status && error, "expected all three tool results");
  assert.deepEqual(textBlocks(exitText), ["job exited with code 9"]);
  assert.deepEqual(textBlocks(status), ["status-ok"]);
  assert.equal(error.isError, true);
  const exitOutput = wireOutput(requests, 1, 0);
  const statusOutput = wireOutput(requests, 1, 1);
  const errorOutput = wireOutput(requests, 1, 2);
  assert.equal(exitOutput, "job exited with code 9");
  assert.equal(statusOutput, "status-ok");
  durationSeconds(errorOutput);
});
