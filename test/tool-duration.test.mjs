import assert from "node:assert/strict";
import test from "node:test";
import toolDuration from "../extensions/tool-duration/index.ts";

function loadExtension(t) {
  const oldEnv = process.env.PI_TOOL_DURATION_THRESHOLD_MS;
  process.env.PI_TOOL_DURATION_THRESHOLD_MS = "0";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.PI_TOOL_DURATION_THRESHOLD_MS;
    else process.env.PI_TOOL_DURATION_THRESHOLD_MS = oldEnv;
  });

  const handlers = new Map();
  toolDuration({
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerFlag() {},
    getFlag() {
      return undefined;
    },
  });
  return handlers;
}

function toolMessage(toolCallId) {
  return {
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "fixture",
      content: [],
      isError: false,
      timestamp: Date.now(),
    },
  };
}

test("clears pending timings on every lifecycle boundary", async (t) => {
  const handlers = loadExtension(t);

  for (const boundary of ["session_start", "agent_end", "agent_settled", "session_shutdown"]) {
    const pendingDuration = `${boundary}-duration`;
    await handlers.get("tool_execution_start")({ toolCallId: pendingDuration });
    await handlers.get("tool_execution_end")({ toolCallId: pendingDuration, isError: false });
    await handlers.get(boundary)();
    assert.equal(await handlers.get("message_end")(toolMessage(pendingDuration)), undefined);

    const pendingStart = `${boundary}-start`;
    await handlers.get("tool_execution_start")({ toolCallId: pendingStart });
    await handlers.get(boundary)();
    await handlers.get("tool_execution_end")({ toolCallId: pendingStart, isError: false });
    assert.equal(await handlers.get("message_end")(toolMessage(pendingStart)), undefined);
  }
});
