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

test("indexes a branch once, including known-absent results, and skips history without results", () => {
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
  assert.ok(reads > 0 && reads <= 1006, "Cold replay is at most one ancestry pass plus selected timing data");

  reads = 0;
  context({ messages: [structuredClone(fast)] }, { sessionManager: manager });
  assert.equal(reads, 0, "An untimed result is a cached occurrence, not another ancestry join");
  reads = 0;
  context({ messages: [] }, { sessionManager: manager });
  assert.equal(reads, 0);
});

test("warmed orphan requests are history-independent and append/navigation reconcile occurrences", () => {
  for (const size of [10, 43000]) {
    const sm = SessionManager.inMemory();
    for (let i = 0; i < size; i++) sm.appendMessage({ role: "user", content: "archived", timestamp: i });
    const anchor = sm.getLeafId();
    const orphan = toolMessage("reused", size + 1).message;
    sm.appendMessage(orphan);
    let reads = 0;
    const manager = {
      getLeafId: () => sm.getLeafId(),
      getEntry(id) { reads++; return sm.getEntry(id); },
      getBranch() { assert.fail("no full-branch copies"); },
      getEntries() { assert.fail("no full-journal copies"); },
    };
    const handlers = loadExtension(sm);
    const context = messages => handlers.get("context_with_system")({ messages }, { sessionManager: manager }).messages;
    assert.deepEqual(context([orphan]), [orphan]);
    assert.equal(reads, size + 1);
    for (let i = 0; i < 3; i++) {
      reads = 0;
      assert.deepEqual(context([orphan, toolMessage("unknown", -1).message]), [orphan, toolMessage("unknown", -1).message]);
      assert.equal(reads, 0, "both known absence and unknown payloads are warmed");
    }
    sm.appendMessage(assistantCalls("reused"));
    sm.appendCustomEntry("pi-tool-duration", { toolCallId: "reused", timestamp: 0, duration: "[duration: 2.0s]" });
    const timed = toolMessage("reused", size + 2).message;
    sm.appendMessage(timed);
    reads = 0;
    assert.deepEqual(context([orphan, timed]).map(texts), [[], ["[duration: 2.0s]"]]);
    assert.equal(reads, 4, "only the appended suffix plus selected timing data");
    sm.appendCompaction("summary", null, 100);
    reads = 0;
    const preparation = { messagesToSummarize: [timed], turnPrefixMessages: [orphan, timed] };
    handlers.get("session_before_compact")({ preparation }, { sessionManager: manager });
    assert.equal(reads, 1, "one suffix lookup for both compaction arrays");
    assert.deepEqual(preparation.messagesToSummarize.map(texts), [["[duration: 2.0s]"]]);
    assert.deepEqual(preparation.turnPrefixMessages.map(texts), [[], ["[duration: 2.0s]"]]);
    sm.branch(anchor);
    sm.appendMessage(timed); // Identical ID/timestamp on another branch, without timing.
    assert.deepEqual(context([timed]), [timed], "sibling occurrence cannot inherit timing");
    handlers.get("session_tree")();
    assert.deepEqual(context([timed]), [timed]);
  }
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
  // Batched completions can persist timing A, timing B, result A, result B.
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

test("same call ID and finalized timestamp retain separate occurrence timing", () => {
  for (const distinctContent of [false, true]) {
    const sm = SessionManager.inMemory();
    const first = { ...toolMessage("reused", 1).message, content: [{ type: "text", text: "first" }] };
    const second = { ...first, content: [{ type: "text", text: distinctContent ? "second" : "first" }] };
    sm.appendMessage(assistantCalls("reused"));
    sm.appendCustomEntry("pi-tool-duration", { toolCallId: "reused", timestamp: 2, duration: "[duration: 1.5s]" });
    const checkpointCopy = sm.appendMessage(assistantCalls("reused"));
    sm.getEntry(checkpointCopy).checkpoint = true; // Saved 0.99 fork journals repeat assistant calls in these entries.
    sm.appendMessage(first);
    sm.appendMessage(assistantCalls("reused"));
    sm.appendMessage(second);
    const handlers = loadExtension(sm);
    const context = messages => handlers.get("context_with_system")({ messages }, { sessionManager: sm }).messages;
    const expectedFirst = { ...first, content: [...first.content, { type: "text", text: "[duration: 1.5s]" }] };
    assert.deepEqual(context([first, second]), [expectedFirst, second]);
    assert.deepEqual(context([first, second]), [expectedFirst, second], "warmed ordering must be identical");
    const preparation = { messagesToSummarize: [first], turnPrefixMessages: [second] };
    handlers.get("session_before_compact")({ preparation }, { sessionManager: sm });
    assert.deepEqual(texts(preparation.messagesToSummarize[0]), ["[duration: 1.5s]", "first"]);
    assert.deepEqual(preparation.turnPrefixMessages, [second]);
    if (distinctContent) {
      assert.deepEqual(context([first]), [expectedFirst], "filtered distinct content retains occurrence identity");
      assert.deepEqual(context([second]), [second]);
    }
  }
});

test("text-only compaction does no timing history work, even on a cold long branch", () => {
  const handlers = loadExtension();
  const preparation = { messagesToSummarize: [{ role: "user", content: "text", timestamp: 1 }], turnPrefixMessages: [] };
  const before = structuredClone(preparation);
  handlers.get("session_before_compact")({ preparation }, {
    sessionManager: { getLeafId() { assert.fail("no lookup needed"); }, getEntry() { assert.fail("no ancestry work"); } },
  });
  assert.deepEqual(preparation, before);
});

test("skips zero-rounded successes by default while preserving failures and threshold overrides", async (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const configured = process.env.PI_TOOL_DURATION_THRESHOLD_MS;
  t.after(() => {
    if (configured === undefined) delete process.env.PI_TOOL_DURATION_THRESHOLD_MS;
    else process.env.PI_TOOL_DURATION_THRESHOLD_MS = configured;
  });

  for (const [flag, env, elapsed, isError, expected] of [
    [null, undefined, 49, false, []],
    [null, undefined, 50, false, ["[host tool-call elapsed: 0.1s]"]],
    [null, undefined, 0, true, ["[host tool-call elapsed: 0.0s]"]],
    [null, "0", 0, false, ["[host tool-call elapsed: 0.0s]"]],
    ["0", "60000", 0, false, ["[host tool-call elapsed: 0.0s]"]],
    ["invalid", "0", 0, false, ["[host tool-call elapsed: 0.0s]"]],
    ["invalid", "invalid", 49, false, []],
  ]) {
    if (env === undefined) delete process.env.PI_TOOL_DURATION_THRESHOLD_MS;
    else process.env.PI_TOOL_DURATION_THRESHOLD_MS = env;
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendMessage(assistantCalls("call"));
    const handlers = loadExtension(sessionManager, flag);
    await handlers.get("tool_execution_start")({ toolCallId: "call" });
    clock += elapsed;
    await handlers.get("tool_execution_end")({ toolCallId: "call", isError });
    const message = { ...toolMessage("call").message, isError };
    await handlers.get("message_end")({ message });
    sessionManager.appendMessage(message);
    assert.deepEqual(texts(modelContext(handlers, sessionManager)[1]), expected,
      JSON.stringify({ flag, env, elapsed, isError }));
  }
});
