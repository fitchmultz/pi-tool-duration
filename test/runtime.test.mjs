import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hostDir = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const hostPackage = JSON.parse(readFileSync(join(hostDir, "package.json"), "utf8"));
const bundledCli = resolve(hostDir, hostPackage.bin.pi);
const piCli = process.env.PI_HOST_CLI ?? bundledCli;
assert.equal(realpathSync(piCli), realpathSync(bundledCli), "CLI must belong to the installed selected host");
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR) {
  assert.equal(realpathSync(hostDir), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_COMPAT_EXPECTED_VERSION) {
  assert.equal(hostPackage.version, process.env.PI_COMPAT_EXPECTED_VERSION);
}
const extension = resolve(
  process.env.PI_TOOL_DURATION_TEST_EXTENSION ?? "extensions/tool-duration/index.ts",
);
const fixture = resolve("test/fixtures/runtime-extension.ts");
const MAX_CAPTURE_CHARS = 1_000_000;

async function isolatedEnvironment(overrides = {}) {
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
    },
  };
}

function appendCaptured(current, chunk) {
  return current + chunk.slice(0, MAX_CAPTURE_CHARS - current.length);
}

async function runProcess(args, env) {
  const child = spawn(process.execPath, [piCli, ...args], {
    cwd: resolve("."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data) => {
    stdout = appendCaptured(stdout, data);
  });
  child.stderr.setEncoding("utf8").on("data", (data) => {
    stderr = appendCaptured(stderr, data);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [code, signal] = await once(child, "close");
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

const reasoningItem = {
  type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture-reasoning",
};

function sendScriptedResponse(response, calls, responseId) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const output = calls ? [reasoningItem, ...calls.map((call, index) => ({
    type: "function_call", id: `fc_${index}`, call_id: `call_${index}`,
    name: call.name, arguments: JSON.stringify(call.arguments), status: "completed",
  }))] : [{
    type: "message", id: "msg_done", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "done", annotations: [] }],
  }];
  send({ type: "response.created", response: { id: responseId } });
  for (const [output_index, item] of output.entries()) {
    send({ type: "response.output_item.added", output_index, item });
    send({ type: "response.output_item.done", output_index, item });
  }
  send({
    type: "response.completed",
    response: {
      id: responseId, status: "completed", output,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  response.end();
}

async function runPi({ calls, threshold, flag, reload = false, summarize, replaceTimestamp = false }) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    sendScriptedResponse(response, requests.length === 1 ? calls : undefined, `resp_fixture_${requests.length}`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const isolation = await isolatedEnvironment({
    ...(threshold === undefined ? {} : { PI_TOOL_DURATION_THRESHOLD_MS: threshold }),
    PI_TOOL_DURATION_TEST_PORT: String(port),
    PI_TOOL_DURATION_TEST_REPLACE_TIMESTAMP: String(replaceTimestamp),
  });

  if (summarize) {
    await mkdir(join(isolation.root, "agent"), { recursive: true });
    await writeFile(join(isolation.root, "agent/settings.json"), JSON.stringify({
      compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: summarize === "history" ? 128 : 1 },
    }));
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
  if (flag !== undefined) args.push("--tool-duration-threshold-ms", flag);
  args.push("-p", "Run the scripted test scenario.");
  if (reload) args.push("/duration-test-reload", "Continue after reloading.");
  // A full second turn puts the cut at its user message instead of splitting the first turn.
  if (summarize === "history") args.push(`New turn: ${"context ".repeat(100)}`);
  if (summarize) args.push("/duration-test-compact");

  try {
    const { code, signal, stdout, stderr } = await runProcess(args, isolation.env);
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.equal(requests.length, 2 + Number(reload) + Number(Boolean(summarize)) + Number(summarize === "history"), stderr);
    for (const request of requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.body.model, "scripted");
      assert.equal(request.body.stream, true);
    }
    assert.ok(requests[0].body.tools.some((tool) => tool.name === "duration_fixture"));
    assert.ok(requests[1].body.input.some((message) => message.type === "function_call_output"));

    return {
      stderr,
      requests,
      events: stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    };
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(isolation.root, { recursive: true, force: true });
  }
}

function toolMessages(events) {
  return events
    .filter((event) => event.type === "message_end" && event.message?.role === "toolResult")
    .map((event) => event.message);
}

function textBlocks(message) {
  return message.content.filter((item) => item.type === "text").map((item) => item.text);
}

function modelToolOutputs(request) {
  return request.body.input.filter((item) => item.type === "function_call_output").map((item) => item.output);
}

function durationSeconds(text) {
  const match = /(?:^|\n)\[host tool-call elapsed: (\d+\.\d)s\]$/.exec(text);
  assert.ok(match, `invalid duration marker: ${text}`);
  return Number(match[1]);
}

test("keeps the long threshold flag readable in help output", async () => {
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

test("applies the threshold independently to parallel tools", async () => {
  const { events, requests } = await runPi({
    calls: [
      { name: "duration_fixture", arguments: { action: "fast" } },
      { name: "duration_fixture", arguments: { action: "slow" } },
    ],
    threshold: "500",
  });

  const [fast, slow] = toolMessages(events);
  assert.deepEqual(textBlocks(fast), ["fast-ok"]);
  assert.deepEqual(textBlocks(slow), ["slow-ok"]);
  const [fastOutput, slowOutput] = modelToolOutputs(requests[1]);
  assert.equal(fastOutput, "fast-ok");
  assert.ok(durationSeconds(slowOutput) >= 0.5);
  assert.deepEqual(slow.details, { status: 201 });
});

test("ignores an invalid CLI threshold and uses the environment", async () => {
  const { requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
    threshold: "0",
    flag: "not-a-number",
  });

  durationSeconds(modelToolOutputs(requests[1])[0]);
});

test("lets the CLI threshold override the environment", async () => {
  const calls = [{ name: "duration_fixture", arguments: { action: "fast" } }];
  const suppressed = await runPi({ calls, threshold: "0", flag: "60000" });
  assert.deepEqual(textBlocks(toolMessages(suppressed.events)[0]), ["fast-ok"]);
  assert.deepEqual(modelToolOutputs(suppressed.requests[1]), ["fast-ok"]);

  const annotated = await runPi({ calls, threshold: "60000", flag: "0" });
  durationSeconds(modelToolOutputs(annotated.requests[1])[0]);
});

test("measures slow tool output that looks like a duration marker", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "marker" } }],
    threshold: "50",
  });

  const [message] = toolMessages(events);
  const texts = textBlocks(message);
  assert.deepEqual(texts, ["[host tool-call elapsed: 9.9s]"]);
  const [output] = modelToolOutputs(requests[1]);
  assert.ok(output.startsWith("[host tool-call elapsed: 9.9s]\n"));
  assert.equal(output.match(/\[host tool-call elapsed:/g).length, 2);
  durationSeconds(output);
});

test("times every tool by default without duplicating tool execution output", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
  });

  const executionEnd = events.find((event) => event.type === "tool_execution_end");
  assert.deepEqual(textBlocks(executionEnd.result), ["fast-ok"]);

  const [message] = toolMessages(events);
  assert.deepEqual(textBlocks(message), ["fast-ok"]);

  const outboundTool = requests[1].body.input.find((item) => item.type === "function_call_output");
  assert.match(JSON.stringify(outboundTool), /\[host tool-call elapsed: \d+\.\ds\]/);
});

test("preserves the native Responses prefix when a timed tool activates another tool", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "load" } }],
    threshold: "0",
  });
  const [initial, next] = requests.map((request) => request.body);
  assert.deepEqual(initial.tools.map((tool) => tool.name), ["duration_fixture"]);
  assert.deepEqual(next.tools, initial.tools, "initial tool declarations must not be hoisted or replaced");
  assert.deepEqual(next.input.slice(0, initial.input.length), initial.input, "the prompt prefix must stay byte-for-byte stable");
  const resultIndex = next.input.findIndex((item) => item.type === "function_call_output");
  const additionIndex = next.input.findIndex((item) => item.type === "additional_tools");
  assert.ok(additionIndex > resultIndex, "new tools belong inline after the timed result");
  assert.deepEqual(next.input[additionIndex].tools.map((tool) => tool.name), ["duration_extra"]);
  assert.match(JSON.stringify(next.input.slice(additionIndex + 1)), /Extra fixture available after loading/);
  assert.deepEqual(next.input.find((item) => item.type === "reasoning"), reasoningItem);
  const call = next.input.find((item) => item.type === "function_call");
  const result = next.input[resultIndex];
  assert.equal(call.call_id, result.call_id);
  const [message] = toolMessages(events);
  assert.equal(message.toolCallId, "call_0|fc_0");
  assert.deepEqual(message.content, [
    { type: "text", text: "loaded-extra" },
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" },
  ]);
  assert.deepEqual(message.details, { status: 201 });
  assert.deepEqual(events.find((event) => event.type === "tool_execution_end").result.content, message.content);
  assert.equal(result.output.length, 2);
  assert.ok(result.output[0].text.startsWith("loaded-extra\n"));
  durationSeconds(result.output[0].text);
  assert.deepEqual(result.output[1], {
    type: "input_image", detail: "auto", image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  });
  assert.ok(!JSON.stringify(next).includes('"status":201'), "raw tool details must stay off the wire");
});

test("retains timing when a later message_end handler replaces the result timestamp", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "status" } }],
    replaceTimestamp: true,
    threshold: "0",
  });
  const [message] = toolMessages(events);
  assert.equal(message.timestamp, 1);
  assert.deepEqual(textBlocks(message), ["status-ok"]);
  assert.deepEqual(message.details, { status: 200 });
  assert.deepEqual(events.find((event) => event.type === "tool_execution_end").result, {
    content: [{ type: "text", text: "status-ok" }], details: { status: 200 },
  });
  const [output] = modelToolOutputs(requests[1]);
  assert.ok(output.startsWith("status-ok\n"));
  durationSeconds(output);
});

test("retains model-only timing after reloading extensions without duplicating it", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
    threshold: "0",
    reload: true,
  });

  assert.deepEqual(textBlocks(toolMessages(events)[0]), ["fast-ok"]);
  const [before] = modelToolOutputs(requests[1]);
  const [after] = modelToolOutputs(requests[2]);
  durationSeconds(before);
  assert.equal(after, before);
  assert.equal(after.match(/\[host tool-call elapsed:/g).length, 1);
});

for (const summarize of ["prefix", "history"]) {
  for (const action of ["fast", "long"]) {
    test(`keeps ${action} output timing in ${summarize} summaries without changing recorded tool output`, async () => {
      const originalText = action === "long" ? "long-output ".repeat(400) : "fast-ok";
      const { events, requests, stderr } = await runPi({
        calls: [{ name: "duration_fixture", arguments: { action } }],
        threshold: "0",
        summarize,
      });
      assert.doesNotMatch(stderr, /Extension error/);
      const [message] = toolMessages(events);
      assert.deepEqual(textBlocks(message), [originalText]);
      assert.deepEqual(message.details, action === "long" ? { status: 200 } : undefined);
      const executionEnd = events.find((event) => event.type === "tool_execution_end");
      assert.deepEqual(textBlocks(executionEnd.result), [originalText]);
      const [output] = modelToolOutputs(requests[1]);
      durationSeconds(output);
      const durations = output.match(/\[host tool-call elapsed: \d+\.\ds\]/g);
      assert.equal(durations.length, 1);
      const [duration] = durations;
      assert.equal(output, `${originalText}\n${duration}`);
      const summaryInput = JSON.stringify(requests.at(-1).body.input);
      assert.ok(summaryInput.includes(originalText.slice(0, 100)), summaryInput);
      if (action === "long") {
        assert.match(summaryInput, /more characters truncated/);
        assert.ok(!summaryInput.includes(originalText), "native summarization must truncate the long output");
      }
      const snapshot = events.find((event) => event.type === "message_end" &&
        event.message?.customType === "duration-test-recorded").message;
      const recorded = JSON.parse(snapshot.content).find((entry) =>
        entry.type === "message" && entry.message.role === "toolResult").message;
      assert.deepEqual(recorded, message);
      assert.ok(summaryInput.includes(duration), "summarizer must receive the original timing");
      assert.equal(summaryInput.match(/\[host tool-call elapsed:/g).length, 1);
    });
  }
}

test("annotates failures blocked during tool preflight", async () => {
  const { events, requests } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "blocked" } }],
    threshold: "60000",
  });

  const [message] = toolMessages(events);
  assert.equal(message.isError, true);
  assert.match(textBlocks(message)[0], /fixture blocked/);
  durationSeconds(modelToolOutputs(requests[1])[0]);
});

test("normalizes missing tool content before appending a duration", async () => {
  const { events, requests, stderr } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "no_content" } }],
    threshold: "0",
  });

  assert.doesNotMatch(stderr, /Extension error/);
  const [message] = toolMessages(events);
  assert.deepEqual(textBlocks(message), []);
  durationSeconds(modelToolOutputs(requests[1])[0]);
});

test("only failed fast results bypass a high threshold", async () => {
  const { events, requests } = await runPi({
    threshold: "60000",
    calls: [
      { name: "duration_fixture", arguments: { action: "exit_text" } },
      { name: "duration_fixture", arguments: { action: "status" } },
      { name: "duration_fixture", arguments: { action: "error" } },
    ],
  });

  const [exitText, status, error] = toolMessages(events);
  assert.deepEqual(textBlocks(exitText), ["job exited with code 9"]);
  assert.deepEqual(textBlocks(status), ["status-ok"]);
  assert.equal(error.isError, true);
  const [exitOutput, statusOutput, errorOutput] = modelToolOutputs(requests[1]);
  assert.equal(exitOutput, "job exited with code 9");
  assert.equal(statusOutput, "status-ok");
  durationSeconds(errorOutput);
});
