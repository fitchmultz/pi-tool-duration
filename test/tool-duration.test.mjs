import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import toolDuration from "../extensions/tool-duration/index.ts";

function loadExtension(sessionManager = SessionManager.inMemory(), threshold = "0") {
  const handlers = new Map();
  toolDuration({
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerFlag() {},
    getFlag() {
      return threshold;
    },
    appendEntry(customType, data) {
      sessionManager.appendCustomEntry(customType, data);
    },
  });
  return handlers;
}

function toolMessage(toolCallId, timestamp = Date.now()) {
  return {
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "fixture",
      content: [],
      isError: false,
      timestamp,
    },
  };
}

async function recordTool(handlers, sessionManager, message) {
  const { toolCallId } = message;
  await handlers.get("tool_execution_start")({ toolCallId });
  await handlers.get("tool_execution_end")({ toolCallId, isError: false });
  await handlers.get("message_end")({ message });
  return sessionManager.appendMessage(message);
}

function modelContext(handlers, sessionManager) {
  return handlers.get("context")(
    { messages: structuredClone(sessionManager.buildSessionContext().messages) },
    { sessionManager },
  ).messages;
}

const texts = (message) => message.content.map((item) => item.text);

test("clears pending timings on startup and agent completion", async () => {
  const sessionManager = SessionManager.inMemory();
  const handlers = loadExtension(sessionManager);

  for (const boundary of ["session_start", "agent_end", "agent_settled"]) {
    const pendingDuration = `${boundary}-duration`;
    await handlers.get("tool_execution_start")({ toolCallId: pendingDuration });
    await handlers.get("tool_execution_end")({ toolCallId: pendingDuration, isError: false });
    await handlers.get(boundary)();
    await handlers.get("message_end")(toolMessage(pendingDuration));

    const pendingStart = `${boundary}-start`;
    await handlers.get("tool_execution_start")({ toolCallId: pendingStart });
    await handlers.get(boundary)();
    await handlers.get("tool_execution_end")({ toolCallId: pendingStart, isError: false });
    await handlers.get("message_end")(toolMessage(pendingStart));
    assert.deepEqual(sessionManager.getEntries(), []);
  }
});

test("fresh instances cannot inherit unfinished timing maps", async () => {
  const sessionManager = SessionManager.inMemory();
  const old = loadExtension(sessionManager);
  await old.get("tool_execution_start")({ toolCallId: "start-only" });
  await old.get("tool_execution_start")({ toolCallId: "duration-only" });
  await old.get("tool_execution_end")({ toolCallId: "duration-only", isError: true });

  const fresh = loadExtension(sessionManager);
  await fresh.get("session_start")();
  await fresh.get("tool_execution_end")({ toolCallId: "start-only", isError: true });
  await fresh.get("message_end")(toolMessage("start-only"));
  await fresh.get("message_end")(toolMessage("duration-only"));
  assert.deepEqual(sessionManager.getEntries(), []);
  await recordTool(fresh, sessionManager, toolMessage("fresh").message);
  assert.equal(modelContext(fresh, sessionManager)[0].content.length, 1);
});

test("restores timing from serialized entries without changing recorded content or details", async () => {
  const sessionManager = SessionManager.inMemory();
  const handlers = loadExtension(sessionManager);
  const message = {
    ...toolMessage("call", 123).message,
    content: [{ type: "text", text: "[duration: 9.9s]" }],
    details: { status: 201 },
  };
  const original = structuredClone(message);
  await recordTool(handlers, sessionManager, message);
  assert.deepEqual(message, original);

  // Recreate the persisted branch through native APIs with a fresh extension instance.
  const restored = SessionManager.inMemory();
  for (const entry of JSON.parse(JSON.stringify(sessionManager.getBranch()))) {
    if (entry.type === "custom") restored.appendCustomEntry(entry.customType, entry.data);
    else if (entry.type === "message") restored.appendMessage(entry.message);
  }
  const reloadedHandlers = loadExtension(restored);
  await reloadedHandlers.get("session_start")();
  const [first] = modelContext(reloadedHandlers, restored);
  assert.equal(texts(first)[0], "[duration: 9.9s]");
  assert.equal(texts(first).length, 2);
  assert.match(texts(first)[1], /^\[duration: \d+\.\ds\]$/);
  assert.deepEqual(first.details, original.details);
  assert.deepEqual(modelContext(reloadedHandlers, restored), [first]);
  assert.deepEqual(restored.buildSessionContext().messages, [original]);

  // Compaction can retain the tool message while its timing entry is before the kept range.
  restored.appendCompaction("summary", restored.getLeafId(), 100);
  const kept = modelContext(reloadedHandlers, restored).find((item) => item.role === "toolResult");
  assert.deepEqual(kept, first);
});

test("uses only the active branch and distinguishes reused tool call IDs", async () => {
  const sessionManager = SessionManager.inMemory();
  const anchor = sessionManager.appendMessage({ role: "user", content: "test", timestamp: 1 });
  const handlers = loadExtension(sessionManager);
  await recordTool(handlers, sessionManager, toolMessage("reused", 2).message);
  const fastHandlers = loadExtension(sessionManager, "60000");
  await recordTool(fastHandlers, sessionManager, toolMessage("reused", 3).message);
  const results = modelContext(handlers, sessionManager).filter((item) => item.role === "toolResult");
  assert.equal(texts(results[0]).length, 1);
  assert.deepEqual(texts(results[1]), []);

  sessionManager.branch(anchor);
  await recordTool(fastHandlers, sessionManager, toolMessage("reused", 2).message);
  const branched = modelContext(handlers, sessionManager).find((item) => item.role === "toolResult");
  assert.deepEqual(texts(branched), []);
});
