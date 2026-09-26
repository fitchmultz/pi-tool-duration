import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import toolDuration from "../extensions/tool-duration/index.ts";

function loadExtension(sessionManager = SessionManager.inMemory(), threshold = "0") {
  const handlers = new Map();
  toolDuration({
    on(name, handler) {
      handlers.set(name, (event, ctx = { sessionManager }) => handler(event, ctx));
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
  return (handlers.get("context_with_system") ?? handlers.get("context"))(
    { messages: structuredClone(sessionManager.buildSessionContext().messages) },
    { sessionManager },
  ).messages;
}

const texts = (message) => message.content.map((item) => item.text);

function assistantCalls(...ids) {
  return {
    role: "assistant",
    content: ids.map((id) => ({ type: "toolCall", id, name: "fixture", arguments: {} })),
    api: "openai-responses",
    provider: "fixture",
    model: "fixture",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 0,
  };
}

test("associates legacy timing with the finalized result timestamp", () => {
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendCustomEntry("pi-tool-duration", {
    toolCallId: "call", timestamp: 123, duration: "[duration: 1.5s]",
  });
  sessionManager.appendCustomEntry("other-extension", { value: 1 });
  const message = { ...toolMessage("call", 456).message, content: [{ type: "text", text: "original" }] };
  const resultId = sessionManager.appendMessage(message);
  const handlers = loadExtension(sessionManager);

  assert.deepEqual(texts(modelContext(handlers, sessionManager)[0]), ["original", "[duration: 1.5s]"]);
  sessionManager.appendCompaction("summary", resultId, 100);
  assert.deepEqual(texts(modelContext(handlers, sessionManager).find((item) => item.role === "toolResult")), ["original", "[duration: 1.5s]"]);
  assert.deepEqual(message.content, [{ type: "text", text: "original" }]);
});

test("looks up only recent ancestry and skips history when there are no tool results", () => {
  const sessionManager = SessionManager.inMemory();
  for (let i = 0; i < 1000; i++) {
    sessionManager.appendMessage({ role: "user", content: "archived", timestamp: i });
  }
  sessionManager.appendMessage(assistantCalls("timed", "fast"));
  sessionManager.appendCustomEntry("pi-tool-duration", {
    toolCallId: "timed", timestamp: 1, duration: "[duration: 1.5s]",
  });
  sessionManager.appendCustomEntry("other-extension", { value: 1 });
  const timed = toolMessage("timed", 1001).message;
  const fast = toolMessage("fast", 1002).message;
  sessionManager.appendMessage(timed);
  sessionManager.appendMessage(fast);
  let reads = 0;
  const manager = {
    getLeafId: () => sessionManager.getLeafId(),
    getEntry(id) { reads++; return sessionManager.getEntry(id); },
    getBranch() { assert.fail("Request lookup must not rebuild the full branch"); },
  };
  const handlers = loadExtension(sessionManager);
  const context = handlers.get("context_with_system") ?? handlers.get("context");
  const result = context({ messages: structuredClone([timed, fast]) }, { sessionManager: manager });
  assert.deepEqual(result.messages.map(texts), [["[duration: 1.5s]"], []]);
  assert.equal(reads, 5, "Lookup stops at the assistant message that issued the calls");

  reads = 0;
  context({ messages: [structuredClone(fast)] }, { sessionManager: manager });
  assert.equal(reads, 5, "An untimed result stops at its issuing assistant message");
  reads = 0;
  context({ messages: [] }, { sessionManager: manager });
  assert.equal(reads, 0);
});

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
  assert.match(texts(first)[1], /^\[host tool-call elapsed: \d+\.\ds\]$/);
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

test("annotates results published after all of their concurrent timings", async () => {
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendMessage(assistantCalls("fast", "slow"));
  const handlers = loadExtension(sessionManager);
  const fast = toolMessage("fast", 10).message;
  const slow = toolMessage("slow", 11).message;
  for (const { toolCallId } of [fast, slow]) {
    await handlers.get("tool_execution_start")({ toolCallId });
    await handlers.get("tool_execution_end")({ toolCallId, isError: false });
  }
  // Native async completions persist timing A, timing B, result A, result B.
  await handlers.get("message_end")({ message: fast });
  await handlers.get("message_end")({ message: slow });
  sessionManager.appendMessage(fast);
  sessionManager.appendMessage(slow);

  const results = modelContext(handlers, sessionManager);
  assert.equal(results.length, 3);
  for (const result of results.slice(1)) {
    assert.equal(result.content.length, 1);
    assert.match(texts(result)[0], /^\[host tool-call elapsed: \d+\.\ds\]$/);
  }
});

test("sums measured spans across a fork detach and cold resume", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const entries = [];
  const append = (entry) => entries.push({ id: String(entries.length + 1), parentId: entries.at(-1)?.id ?? null, ...entry });
  const journal = {
    appendCustomEntry: (customType, data) => append({ type: "custom", customType, data }),
    getLeafId: () => entries.at(-1)?.id ?? null,
    getEntry: (id) => entries[Number(id) - 1],
  };
  const issued = assistantCalls("delegate");
  append({ type: "message", message: issued });

  const before = loadExtension(journal, "500");
  await before.get("tool_execution_start")({ toolCallId: "delegate" });
  clock += 10_622;
  await before.get("tool_execution_detached")({ toolCallId: "delegate" });
  await before.get("agent_end")();
  append({ type: "message", message: { role: "user", content: "continue", timestamp: 1 } });
  // The fork snapshots the call again when it resumes; only the original message bounds the lookup.
  append({ type: "message", checkpoint: true, message: issued });

  const after = loadExtension(journal, "500");
  await after.get("session_start")();
  clock += 5_000;
  await after.get("tool_execution_start")({ toolCallId: "delegate" });
  clock += 76;
  await after.get("tool_execution_end")({ toolCallId: "delegate", isError: false });
  await after.get("message_end")(toolMessage("delegate", 2));

  assert.deepEqual(entries.filter((entry) => entry.type === "custom").map((entry) => entry.data), [
    { toolCallId: "delegate", elapsedMs: 10_622 },
    { toolCallId: "delegate", timestamp: 2, duration: "[host tool-call elapsed: 10.7s]" },
  ]);
});

test("returns the saved marker as model-only content for fork live continuations", async () => {
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendMessage(assistantCalls("timed", "fast"));
  const timed = { ...toolMessage("timed", 10).message, content: [{ type: "text", text: "live result" }] };
  const fast = toolMessage("fast", 11).message;
  const handlers = loadExtension(sessionManager);
  await recordTool(handlers, sessionManager, timed);
  await recordTool(loadExtension(sessionManager, "60000"), sessionManager, fast);

  const live = await handlers.get("live_tool_result")({ message: timed });
  assert.deepEqual(live.content.slice(0, 1), [{ type: "text", text: "live result" }]);
  assert.match(live.content[1].text, /^\[host tool-call elapsed: \d+\.\ds\]$/);
  assert.equal(live.content.length, 2);
  assert.deepEqual(timed.content, [{ type: "text", text: "live result" }]);
  assert.deepEqual(modelContext(handlers, sessionManager)[1].content, live.content, "live and replay copies match");
  assert.equal(await handlers.get("live_tool_result")({ message: fast }), undefined);
});
