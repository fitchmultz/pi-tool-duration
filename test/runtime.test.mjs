import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";

const pi = resolve("node_modules/.bin/pi");
const extension = resolve(
  process.env.PI_TOOL_DURATION_TEST_EXTENSION ?? "extensions/tool-duration/index.ts",
);
const fixture = resolve("test/fixtures/runtime-extension.ts");

function chunk(model, choices, usage) {
  return {
    id: "chatcmpl-pi-tool-duration",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    ...(usage ? { usage } : {}),
  };
}

function sendScriptedResponse(response, calls) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });

  const model = "scripted";
  if (calls) {
    response.write(
      `data: ${JSON.stringify(
        chunk(model, [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: calls.map((call, index) => ({
                index,
                id: `call_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            },
            finish_reason: null,
          },
        ]),
      )}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify(
        chunk(model, [{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
      )}\n\n`,
    );
  } else {
    response.write(
      `data: ${JSON.stringify(
        chunk(model, [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }]),
      )}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify(chunk(model, [{ index: 0, delta: {}, finish_reason: "stop" }]))}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify(
      chunk(model, [], { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    )}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

async function runPi({ calls, threshold = "60000", flag }) {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request before responding through the real HTTP transport.
    }
    sendScriptedResponse(response, requestCount++ === 0 ? calls : undefined);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  const args = [
    "--no-extensions",
    "--extension",
    extension,
    "--extension",
    fixture,
    "--no-builtin-tools",
    "--tools",
    "duration_fixture",
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
    "off",
  ];
  if (flag !== undefined) args.push("--tool-duration-threshold-ms", flag);
  args.push("-p", "Run the scripted test scenario.");

  const child = spawn(pi, args, {
    cwd: resolve("."),
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      PI_TOOL_DURATION_THRESHOLD_MS: threshold,
      PI_TOOL_DURATION_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data) => (stdout += data));
  child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timeout);
  await new Promise((resolve) => server.close(resolve));

  assert.equal(signal, null, stderr);
  assert.equal(code, 0, stderr);
  return {
    stderr,
    events: stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

function toolMessages(events) {
  return events
    .filter((event) => event.type === "message_end" && event.message?.role === "toolResult")
    .map((event) => event.message);
}

function textBlocks(message) {
  return message.content.filter((item) => item.type === "text").map((item) => item.text);
}

test("applies the threshold independently to parallel tools", async () => {
  const { events } = await runPi({
    calls: [
      { name: "duration_fixture", arguments: { action: "fast" } },
      { name: "duration_fixture", arguments: { action: "slow" } },
    ],
    threshold: "100",
  });

  const [fast, slow] = toolMessages(events);
  assert.deepEqual(textBlocks(fast), ["fast-ok"]);
  assert.equal(textBlocks(slow)[0], "slow-ok");
  assert.match(textBlocks(slow)[1], /^\[duration: 0\.[23]s\]$/);
  assert.deepEqual(slow.details, { status: 201 });
});

test("ignores an invalid CLI threshold and uses the environment", async () => {
  const { events } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
    threshold: "0",
    flag: "not-a-number",
  });

  assert.match(textBlocks(toolMessages(events)[0]).at(-1), /^\[duration: 0\.\ds\]$/);
});

test("lets the CLI threshold override the environment", async () => {
  const calls = [{ name: "duration_fixture", arguments: { action: "fast" } }];
  const suppressed = await runPi({ calls, threshold: "0", flag: "60000" });
  assert.deepEqual(textBlocks(toolMessages(suppressed.events)[0]), ["fast-ok"]);

  const annotated = await runPi({ calls, threshold: "60000", flag: "0" });
  assert.match(textBlocks(toolMessages(annotated.events)[0]).at(-1), /^\[duration: 0\.\ds\]$/);
});

test("measures slow tool output that looks like a duration marker", async () => {
  const { events } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "marker" } }],
    threshold: "50",
  });

  const [message] = toolMessages(events);
  assert.equal(textBlocks(message)[0], "[duration: 9.9s]");
  assert.match(textBlocks(message)[1], /^\[duration: 0\.\ds\]$/);
});

test("keeps durations model-visible without duplicating tool execution output", async () => {
  const { events } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "fast" } }],
    threshold: "0",
  });

  const executionEnd = events.find((event) => event.type === "tool_execution_end");
  assert.deepEqual(textBlocks(executionEnd.result), ["fast-ok"]);

  const [message] = toolMessages(events);
  assert.equal(textBlocks(message)[0], "fast-ok");
  assert.match(textBlocks(message)[1], /^\[duration: 0\.\ds\]$/);
});

test("annotates failures blocked during tool preflight", async () => {
  const { events } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "blocked" } }],
  });

  const [message] = toolMessages(events);
  assert.equal(message.isError, true);
  assert.match(textBlocks(message)[0], /fixture blocked/);
  assert.match(textBlocks(message).at(-1), /^\[duration: 0\.\ds\]$/);
});

test("normalizes missing tool content before appending a duration", async () => {
  const { events, stderr } = await runPi({
    calls: [{ name: "duration_fixture", arguments: { action: "no_content" } }],
    threshold: "0",
  });

  assert.doesNotMatch(stderr, /Extension error/);
  const [message] = toolMessages(events);
  assert.deepEqual(textBlocks(message).length, 1);
  assert.match(textBlocks(message)[0], /^\[duration: 0\.\ds\]$/);
});

test("only failed fast results bypass a high threshold", async () => {
  const { events } = await runPi({
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
  assert.match(textBlocks(error).at(-1), /^\[duration: 0\.\ds\]$/);
});
