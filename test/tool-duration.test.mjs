import assert from "node:assert/strict";
import test from "node:test";
import toolDuration from "../extensions/tool-duration/index.ts";

function loadExtension(env = {}) {
  const oldEnv = { ...process.env };
  Object.assign(process.env, env);

  const handlers = new Map();
  const flags = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerFlag(name, options) {
      flags.set(name, options.default);
    },
    getFlag(name) {
      return flags.get(name);
    },
  };

  toolDuration(pi);
  return {
    handlers,
    flags,
    restoreEnv() {
      process.env = oldEnv;
    },
  };
}

test("annotates only results at or above the threshold", async () => {
  const { handlers, restoreEnv } = loadExtension({ PI_TOOL_DURATION_THRESHOLD_MS: "50" });
  try {
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
  } finally {
    restoreEnv();
  }
});

test("does not append a second duration marker", async () => {
  const { handlers, restoreEnv } = loadExtension({ PI_TOOL_DURATION_THRESHOLD_MS: "0" });
  try {
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
  } finally {
    restoreEnv();
  }
});

test("clears abandoned calls on lifecycle boundaries", async () => {
  const { handlers, restoreEnv } = loadExtension({ PI_TOOL_DURATION_THRESHOLD_MS: "0" });
  try {
    await handlers.get("tool_call")({ toolCallId: "old" });
    await handlers.get("session_start")();

    assert.equal(
      await handlers.get("tool_result")({
        toolCallId: "old",
        content: [{ type: "text", text: "ok" }],
      }),
      undefined,
    );
  } finally {
    restoreEnv();
  }
});
