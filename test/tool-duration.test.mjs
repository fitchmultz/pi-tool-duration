import assert from "node:assert/strict";
import test from "node:test";
import toolDuration from "../extensions/tool-duration/index.ts";

function loadExtension(t, env = {}) {
  const oldEnv = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => {
    process.env = oldEnv;
  });

  const handlers = new Map();
  const flags = new Map();
  toolDuration({
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerFlag(name, options) {
      flags.set(name, options.default);
    },
    getFlag(name) {
      return flags.get(name);
    },
  });

  return handlers;
}

test("annotates only results at or above the threshold", async (t) => {
  const handlers = loadExtension(t, { PI_TOOL_DURATION_THRESHOLD_MS: "50" });

  await handlers.get("tool_call")({ toolCallId: "fast" });
  assert.equal(
    await handlers.get("tool_result")({
      toolCallId: "fast",
      content: [{ type: "text", text: "ok" }],
    }),
    undefined,
  );

  await handlers.get("tool_call")({ toolCallId: "slow" });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const result = await handlers.get("tool_result")({
    toolCallId: "slow",
    content: [{ type: "text", text: "ok" }],
  });

  assert.equal(result.content.length, 2);
  assert.match(result.content[1].text, /^\[duration: 0\.\ds\]$/);
});

test("annotates non-zero exit results even below the threshold", async (t) => {
  const handlers = loadExtension(t, { PI_TOOL_DURATION_THRESHOLD_MS: "60000" });
  await handlers.get("tool_call")({ toolCallId: "fail" });

  const result = await handlers.get("tool_result")({
    toolCallId: "fail",
    content: [{ type: "text", text: "Command exited with code 2" }],
    isError: true,
  });

  assert.equal(result.content.length, 2);
  assert.match(result.content[1].text, /^\[duration: 0\.\ds\]$/);
});

test("does not append a second duration marker", async (t) => {
  const handlers = loadExtension(t, { PI_TOOL_DURATION_THRESHOLD_MS: "0" });
  await handlers.get("tool_call")({ toolCallId: "dup" });

  assert.equal(
    await handlers.get("tool_result")({
      toolCallId: "dup",
      content: [
        { type: "text", text: "ok" },
        { type: "text", text: "[duration: 9.9s]" },
      ],
    }),
    undefined,
  );
});

test("clears abandoned calls on lifecycle boundaries", async (t) => {
  const handlers = loadExtension(t, { PI_TOOL_DURATION_THRESHOLD_MS: "0" });
  await handlers.get("tool_call")({ toolCallId: "old" });
  await handlers.get("session_start")();

  assert.equal(
    await handlers.get("tool_result")({
      toolCallId: "old",
      content: [{ type: "text", text: "ok" }],
    }),
    undefined,
  );
});
