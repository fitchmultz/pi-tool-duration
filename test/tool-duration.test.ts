import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
import {
  SessionManager,
  type ContextEvent,
  type ContextEventResult,
  type ContextWithSystemEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type MessageEndEvent,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import toolDuration from "../extensions/tool-duration/index.ts";

type Messages = ContextWithSystemEvent["messages"];
type ToolResultMessage = Extract<Messages[number], { role: "toolResult" }>;
type Appendable = Parameters<SessionManager["appendMessage"]>[0];
type ManagerView = Pick<ExtensionContext["sessionManager"], "getEntry" | "getLeafId">;
type CtxView = { sessionManager: ManagerView };
type Preparation = Pick<
  SessionBeforeCompactEvent["preparation"],
  "messagesToSummarize" | "turnPrefixMessages"
>;

// The handler signatures the extension registers, as the tests invoke them.
type HostHandlers = {
  tool_execution_start: (
    event: Pick<ToolExecutionStartEvent, "type" | "toolCallId">,
  ) => Promise<void> | void;
  tool_execution_end: (
    event: Pick<ToolExecutionEndEvent, "type" | "toolCallId" | "isError">,
  ) => Promise<void> | void;
  message_end: (event: MessageEndEvent) => Promise<void> | void;
  context_with_system: (event: ContextWithSystemEvent, ctx: CtxView) => ContextEventResult;
  context: (event: ContextEvent, ctx: CtxView) => ContextEventResult;
  session_before_compact: (
    event: Pick<SessionBeforeCompactEvent, "type"> & { preparation: Preparation },
    ctx: CtxView,
  ) => SessionBeforeCompactResult;
  session_start: (event?: unknown, ctx?: unknown) => Promise<void> | void;
  session_tree: (event?: unknown, ctx?: unknown) => Promise<void> | void;
  agent_end: (event?: unknown, ctx?: unknown) => Promise<void> | void;
  agent_settled: (event?: unknown, ctx?: unknown) => Promise<void> | void;
};
type NeverHandler = (event: never, ctx: never) => unknown;
type TestHost = Pick<ExtensionAPI, "registerFlag" | "getFlag" | "appendEntry"> & {
  // The second signature keeps the mock assignable to the full overloaded
  // ExtensionAPI["on"] contract while the extension registers only these events.
  on: {
    <K extends keyof HostHandlers>(name: K, handler: HostHandlers[K]): () => void;
    (name: never, handler: never): () => void;
  };
};
function loadExtension(
  sessionManager: SessionManager = SessionManager.inMemory(),
  threshold: string | null = "0",
) {
  const handlers = new Map<string, NeverHandler>();
  const registeredFlags = new Set<string>();
  const host: TestHost = {
    on(name: string, handler: NeverHandler) {
      handlers.set(name, (event, ctx) => handler(event, ctx));
      return () => {
        handlers.delete(name);
      };
    },
    registerFlag(name: string) {
      registeredFlags.add(name);
    },
    getFlag() {
      return threshold ?? undefined;
    },
    appendEntry(customType: string, data?: unknown) {
      sessionManager.appendCustomEntry(customType, data);
    },
  };
  toolDuration(host);

  function fire(name: "tool_execution_start"): HostHandlers["tool_execution_start"];
  function fire(name: "tool_execution_end"): HostHandlers["tool_execution_end"];
  function fire(name: "message_end"): HostHandlers["message_end"];
  function fire(name: "context_with_system"): HostHandlers["context_with_system"];
  function fire(name: "context"): HostHandlers["context"];
  function fire(name: "session_before_compact"): HostHandlers["session_before_compact"];
  function fire(
    name: "session_start" | "session_tree" | "agent_end" | "agent_settled",
  ): () => Promise<void> | void;
  function fire(name: string): NeverHandler {
    const handler = handlers.get(name);
    assert.ok(handler, `handler not registered: ${name}`);
    return handler;
  }
  return fire;
}

type Fire = ReturnType<typeof loadExtension>;

function toolMessage(
  toolCallId: string,
  timestamp: number = Date.now(),
): { type: "message_end"; message: ToolResultMessage } {
  return {
    type: "message_end",
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

async function recordTool(
  fire: Fire,
  sessionManager: SessionManager,
  message: ToolResultMessage,
): Promise<string> {
  const { toolCallId } = message;
  await fire("tool_execution_start")({ type: "tool_execution_start", toolCallId });
  await fire("tool_execution_end")({ type: "tool_execution_end", toolCallId, isError: false });
  await fire("message_end")({ type: "message_end", message });
  return sessionManager.appendMessage(message);
}

function modelContext(fire: Fire, sessionManager: SessionManager): Messages {
  const result = fire("context_with_system")(
    {
      type: "context_with_system",
      messages: structuredClone(sessionManager.buildSessionContext().messages),
    },
    { sessionManager },
  );
  assert.ok(result.messages, "annotated context must carry messages");
  return result.messages;
}

const texts = (message: Messages[number]): (string | undefined)[] =>
  message.role === "toolResult" || message.role === "assistant"
    ? message.content.map((item) => (item.type === "text" ? item.text : undefined))
    : [];

function assistantCalls(...ids: string[]): Appendable {
  return {
    role: "assistant",
    content: ids.map((id) => ({ type: "toolCall", id, name: "fixture", arguments: {} })),
    api: "openai-responses",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  };
}

function preparationOf(messagesToSummarize: Messages, turnPrefixMessages: Messages): Preparation {
  return { messagesToSummarize, turnPrefixMessages };
}

nodeTest("associates legacy timing with the finalized result timestamp", () => {
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendCustomEntry("pi-tool-duration", {
    toolCallId: "call",
    timestamp: 123,
    duration: "[duration: 1.5s]",
  });
  sessionManager.appendCustomEntry("other-extension", { value: 1 });
  const message = {
    ...toolMessage("call", 456).message,
    content: [{ type: "text" as const, text: "original" }],
  };
  const resultId = sessionManager.appendMessage(message);
  const fire = loadExtension(sessionManager);

  const [firstAnnotated] = modelContext(fire, sessionManager);
  assert.ok(firstAnnotated);
  assert.deepEqual(texts(firstAnnotated), ["original", "[duration: 1.5s]"]);
  sessionManager.appendCompaction("summary", resultId, 100);
  const compacted = modelContext(fire, sessionManager).find((item) => item.role === "toolResult");
  assert.ok(compacted);
  assert.deepEqual(texts(compacted), ["original", "[duration: 1.5s]"]);
  assert.deepEqual(message.content, [{ type: "text", text: "original" }]);
});

nodeTest(
  "indexes a branch once, including known-absent results, and skips history without results",
  () => {
    const sessionManager = SessionManager.inMemory();
    for (let i = 0; i < 1000; i++) {
      sessionManager.appendMessage({ role: "user", content: "archived", timestamp: i });
    }
    sessionManager.appendMessage(assistantCalls("timed", "fast"));
    sessionManager.appendCustomEntry("pi-tool-duration", {
      toolCallId: "timed",
      timestamp: 1,
      duration: "[duration: 1.5s]",
    });
    sessionManager.appendCustomEntry("other-extension", { value: 1 });
    const timed = toolMessage("timed", 1001).message;
    const fast = toolMessage("fast", 1002).message;
    sessionManager.appendMessage(timed);
    sessionManager.appendMessage(fast);
    let reads = 0;
    const manager = {
      getLeafId: () => sessionManager.getLeafId(),
      getEntry(id: string) {
        reads++;
        return sessionManager.getEntry(id);
      },
      getBranch() {
        assert.fail("Request lookup must not rebuild the full branch");
      },
    };
    const fire = loadExtension(sessionManager);
    const context = (messages: Messages, sm: ManagerView) =>
      fire("context_with_system")(
        { type: "context_with_system", messages },
        { sessionManager: sm },
      );
    const result = context(structuredClone([timed, fast]), manager);
    assert.ok(result.messages);
    assert.deepEqual(result.messages.map(texts), [["[duration: 1.5s]"], []]);
    assert.ok(
      reads > 0 && reads <= 1006,
      "Cold replay is at most one ancestry pass plus selected timing data",
    );

    reads = 0;
    context([structuredClone(fast)], manager);
    assert.equal(reads, 0, "An untimed result is a cached occurrence, not another ancestry join");
    reads = 0;
    context([], manager);
    assert.equal(reads, 0);
  },
);

nodeTest(
  "warmed orphan requests are history-independent and append/navigation reconcile occurrences",
  async () => {
    for (const size of [10, 43000]) {
      const sm = SessionManager.inMemory();
      for (let i = 0; i < size; i++) {
        sm.appendMessage({ role: "user", content: "archived", timestamp: i });
      }
      const anchor = sm.getLeafId();
      const orphan = toolMessage("reused", size + 1).message;
      sm.appendMessage(orphan);
      let reads = 0;
      const manager = {
        getLeafId: () => sm.getLeafId(),
        getEntry(id: string) {
          reads++;
          return sm.getEntry(id);
        },
        getBranch() {
          assert.fail("no full-branch copies");
        },
        getEntries() {
          assert.fail("no full-journal copies");
        },
      };
      const fire = loadExtension(sm);
      const context = (messages: Messages): Messages => {
        const result = fire("context_with_system")(
          { type: "context_with_system", messages },
          { sessionManager: manager },
        );
        assert.ok(result.messages);
        return result.messages;
      };
      assert.deepEqual(context([orphan]), [orphan]);
      assert.equal(reads, size + 1);
      for (let i = 0; i < 3; i++) {
        reads = 0;
        const unknown = toolMessage("unknown", -1).message;
        assert.deepEqual(context([orphan, unknown]), [orphan, unknown]);
        assert.equal(reads, 0, "both known absence and unknown payloads are warmed");
      }
      sm.appendMessage(assistantCalls("reused"));
      sm.appendCustomEntry("pi-tool-duration", {
        toolCallId: "reused",
        timestamp: 0,
        duration: "[duration: 2.0s]",
      });
      const timed = toolMessage("reused", size + 2).message;
      sm.appendMessage(timed);
      reads = 0;
      assert.deepEqual(context([orphan, timed]).map(texts), [[], ["[duration: 2.0s]"]]);
      assert.equal(reads, 4, "only the appended suffix plus selected timing data");
      sm.appendCompaction("summary", null, 100);
      reads = 0;
      const preparation = preparationOf([timed], [orphan, timed]);
      fire("session_before_compact")(
        { type: "session_before_compact", preparation },
        { sessionManager: manager },
      );
      assert.equal(reads, 1, "one suffix lookup for both compaction arrays");
      assert.deepEqual(preparation.messagesToSummarize.map(texts), [["[duration: 2.0s]"]]);
      assert.deepEqual(preparation.turnPrefixMessages.map(texts), [[], ["[duration: 2.0s]"]]);
      assert.ok(anchor !== null, "branch anchor must exist");
      sm.branch(anchor);
      sm.appendMessage(timed); // Identical ID/timestamp on another branch, without timing.
      assert.deepEqual(context([timed]), [timed], "sibling occurrence cannot inherit timing");
      await fire("session_tree")();
      assert.deepEqual(context([timed]), [timed]);
    }
  },
);

nodeTest("clears pending timings on startup and agent completion", async () => {
  const sessionManager = SessionManager.inMemory();
  const fire = loadExtension(sessionManager);

  for (const boundary of ["session_start", "agent_end", "agent_settled"] as const) {
    const pendingDuration = `${boundary}-duration`;
    await fire("tool_execution_start")({
      type: "tool_execution_start",
      toolCallId: pendingDuration,
    });
    await fire("tool_execution_end")({
      type: "tool_execution_end",
      toolCallId: pendingDuration,
      isError: false,
    });
    await fire(boundary)();
    await fire("message_end")(toolMessage(pendingDuration));

    const pendingStart = `${boundary}-start`;
    await fire("tool_execution_start")({ type: "tool_execution_start", toolCallId: pendingStart });
    await fire(boundary)();
    await fire("tool_execution_end")({
      type: "tool_execution_end",
      toolCallId: pendingStart,
      isError: false,
    });
    await fire("message_end")(toolMessage(pendingStart));
    assert.deepEqual(sessionManager.getEntries(), []);
  }
});

nodeTest("fresh instances cannot inherit unfinished timing maps", async () => {
  const sessionManager = SessionManager.inMemory();
  const old = loadExtension(sessionManager);
  await old("tool_execution_start")({ type: "tool_execution_start", toolCallId: "start-only" });
  await old("tool_execution_start")({ type: "tool_execution_start", toolCallId: "duration-only" });
  await old("tool_execution_end")({
    type: "tool_execution_end",
    toolCallId: "duration-only",
    isError: true,
  });

  const fresh = loadExtension(sessionManager);
  await fresh("session_start")();
  await fresh("tool_execution_end")({
    type: "tool_execution_end",
    toolCallId: "start-only",
    isError: true,
  });
  await fresh("message_end")(toolMessage("start-only"));
  await fresh("message_end")(toolMessage("duration-only"));
  assert.deepEqual(sessionManager.getEntries(), []);
  await recordTool(fresh, sessionManager, toolMessage("fresh").message);
  const [freshResult] = modelContext(fresh, sessionManager);
  assert.ok(freshResult);
  assert.equal(texts(freshResult).length, 1);
});

nodeTest(
  "restores timing from serialized entries without changing recorded content or details",
  async () => {
    const sessionManager = SessionManager.inMemory();
    const fire = loadExtension(sessionManager);
    const message: ToolResultMessage = {
      ...toolMessage("call", 123).message,
      content: [{ type: "text" as const, text: "[duration: 9.9s]" }],
      details: { status: 201 },
    };
    const original = structuredClone(message);
    await recordTool(fire, sessionManager, message);
    assert.deepEqual(message, original);

    // Recreate the persisted branch through native APIs with a fresh extension instance.
    const restored = SessionManager.inMemory();
    for (const entry of structuredClone(sessionManager.getBranch())) {
      if (entry.type === "custom") {
        restored.appendCustomEntry(entry.customType, entry.data);
      } else if (entry.type === "message") {
        const { message: entryMessage } = entry;
        assert.ok(entryMessage.role === "assistant" || entryMessage.role === "toolResult");
        restored.appendMessage(entryMessage);
      }
    }
    const reloadedFire = loadExtension(restored);
    await reloadedFire("session_start")();
    const [firstMessage] = modelContext(reloadedFire, restored);
    assert.ok(firstMessage && firstMessage.role === "toolResult");
    const first = firstMessage;
    const firstTexts = texts(first);
    assert.equal(firstTexts[0], "[duration: 9.9s]");
    assert.equal(firstTexts.length, 2);
    const marker = firstTexts[1];
    assert.ok(marker !== undefined, "duration marker must be text");
    assert.match(marker, /^\[host tool-call elapsed: \d+\.\ds\]$/);
    assert.deepEqual(first.details, original.details);
    assert.deepEqual(modelContext(reloadedFire, restored), [first]);
    assert.deepEqual(restored.buildSessionContext().messages, [original]);

    // Compaction can retain the tool message while its timing entry is before the kept range.
    restored.appendCompaction("summary", restored.getLeafId(), 100);
    const kept = modelContext(reloadedFire, restored).find((item) => item.role === "toolResult");
    assert.deepEqual(kept, first);
  },
);

nodeTest("uses only the active branch and distinguishes reused tool call IDs", async () => {
  const sessionManager = SessionManager.inMemory();
  const anchor = sessionManager.appendMessage({ role: "user", content: "test", timestamp: 1 });
  const fire = loadExtension(sessionManager);
  await recordTool(fire, sessionManager, toolMessage("reused", 2).message);
  const fastFire = loadExtension(sessionManager, "60000");
  await recordTool(fastFire, sessionManager, toolMessage("reused", 3).message);
  const results = modelContext(fire, sessionManager).filter((item) => item.role === "toolResult");
  const [first, second] = results;
  assert.ok(first);
  assert.ok(second);
  assert.equal(texts(first).length, 1);
  assert.deepEqual(texts(second), []);

  sessionManager.branch(anchor);
  await recordTool(fastFire, sessionManager, toolMessage("reused", 2).message);
  const branched = modelContext(fire, sessionManager).find((item) => item.role === "toolResult");
  assert.ok(branched);
  assert.deepEqual(texts(branched), []);
});

nodeTest("annotates results published after all of their concurrent timings", async () => {
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendMessage(assistantCalls("fast", "slow"));
  const fire = loadExtension(sessionManager);
  const fast = toolMessage("fast", 10).message;
  const slow = toolMessage("slow", 11).message;
  for (const { toolCallId } of [fast, slow]) {
    await fire("tool_execution_start")({ type: "tool_execution_start", toolCallId });
    await fire("tool_execution_end")({ type: "tool_execution_end", toolCallId, isError: false });
  }
  // Batched completions can persist timing A, timing B, result A, result B.
  await fire("message_end")({ type: "message_end", message: fast });
  await fire("message_end")({ type: "message_end", message: slow });
  sessionManager.appendMessage(fast);
  sessionManager.appendMessage(slow);

  const results = modelContext(fire, sessionManager);
  assert.equal(results.length, 3);
  for (const result of results.slice(1)) {
    assert.equal(texts(result).length, 1);
    const [marker] = texts(result);
    assert.ok(marker !== undefined, "duration marker must be text");
    assert.match(marker, /^\[host tool-call elapsed: \d+\.\ds\]$/);
  }
});

nodeTest("same call ID and finalized timestamp retain separate occurrence timing", () => {
  for (const distinctContent of [false, true]) {
    const sm = SessionManager.inMemory();
    const first: ToolResultMessage = {
      ...toolMessage("reused", 1).message,
      content: [{ type: "text" as const, text: "first" }],
    };
    const second: ToolResultMessage = {
      ...first,
      content: [{ type: "text" as const, text: distinctContent ? "second" : "first" }],
    };
    sm.appendMessage(assistantCalls("reused"));
    sm.appendCustomEntry("pi-tool-duration", {
      toolCallId: "reused",
      timestamp: 2,
      duration: "[duration: 1.5s]",
    });
    const checkpointCopy = sm.appendMessage(assistantCalls("reused"));
    const copyEntry = sm.getEntry(checkpointCopy);
    assert.ok(copyEntry, "checkpoint copy entry must exist");
    // Saved 0.99 fork journals repeat assistant calls in these entries.
    Object.assign(copyEntry, { checkpoint: true });
    sm.appendMessage(first);
    sm.appendMessage(assistantCalls("reused"));
    sm.appendMessage(second);
    const fire = loadExtension(sm);
    const context = (messages: Messages): Messages => {
      const result = fire("context_with_system")(
        { type: "context_with_system", messages },
        { sessionManager: sm },
      );
      assert.ok(result.messages);
      return result.messages;
    };
    const expectedFirst: ToolResultMessage = {
      ...first,
      content: [...first.content, { type: "text" as const, text: "[duration: 1.5s]" }],
    };
    assert.deepEqual(context([first, second]), [expectedFirst, second]);
    assert.deepEqual(
      context([first, second]),
      [expectedFirst, second],
      "warmed ordering must be identical",
    );
    const preparation = preparationOf([first], [second]);
    fire("session_before_compact")(
      { type: "session_before_compact", preparation },
      { sessionManager: sm },
    );
    const [summarized] = preparation.messagesToSummarize;
    assert.ok(summarized);
    assert.deepEqual(texts(summarized), ["[duration: 1.5s]", "first"]);
    assert.deepEqual(preparation.turnPrefixMessages, [second]);
    if (distinctContent) {
      assert.deepEqual(
        context([first]),
        [expectedFirst],
        "filtered distinct content retains occurrence identity",
      );
      assert.deepEqual(context([second]), [second]);
    }
  }
  const sm = SessionManager.inMemory();
  const messages: ToolResultMessage[] = [];
  for (const [index, text] of ["A", "A", "B"].entries()) {
    sm.appendMessage(assistantCalls("same"));
    sm.appendCustomEntry("pi-tool-duration", {
      toolCallId: "same",
      timestamp: index,
      duration: `[duration: ${index + 1}.5s]`,
    });
    const message: ToolResultMessage = {
      ...toolMessage("same", 1).message,
      content: [{ type: "text" as const, text }],
    };
    sm.appendMessage(message);
    messages.push(message);
  }
  const fire = loadExtension(sm);
  const filtered = messages.slice(0, 2);
  const context = fire("context_with_system")(
    { type: "context_with_system", messages: structuredClone(filtered) },
    { sessionManager: sm },
  );
  assert.ok(context.messages);
  assert.deepEqual(
    context.messages.map(texts),
    [
      ["A", "[duration: 1.5s]"],
      ["A", "[duration: 2.5s]"],
    ],
    "filtering a distinguishable later occurrence cannot reverse the matching queue",
  );
  const [firstFiltered, secondFiltered] = filtered;
  assert.ok(firstFiltered);
  assert.ok(secondFiltered);
  const preparation = preparationOf([firstFiltered], [secondFiltered]);
  fire("session_before_compact")(
    { type: "session_before_compact", preparation },
    { sessionManager: sm },
  );
  assert.deepEqual(preparation.messagesToSummarize.map(texts), [["[duration: 1.5s]", "A"]]);
  assert.deepEqual(preparation.turnPrefixMessages.map(texts), [["[duration: 2.5s]", "A"]]);
});

nodeTest("text-only compaction does no timing history work, even on a cold long branch", () => {
  const fire = loadExtension();
  const preparation = preparationOf([{ role: "user", content: "text", timestamp: 1 }], []);
  const before = structuredClone(preparation);
  fire("session_before_compact")(
    { type: "session_before_compact", preparation },
    {
      sessionManager: {
        getLeafId() {
          assert.fail("no lookup needed");
        },
        getEntry() {
          assert.fail("no ancestry work");
        },
      },
    },
  );
  assert.deepEqual(preparation, before);
});

nodeTest(
  "skips zero-rounded successes by default while preserving failures and threshold overrides",
  async (t) => {
    let clock = 0;
    t.mock.method(performance, "now", () => clock);
    const configured = process.env.PI_TOOL_DURATION_THRESHOLD_MS;
    t.after(() => {
      if (configured === undefined) {
        delete process.env.PI_TOOL_DURATION_THRESHOLD_MS;
      } else {
        process.env.PI_TOOL_DURATION_THRESHOLD_MS = configured;
      }
    });

    for (const [flag, env, elapsed, isError, expected] of [
      [null, undefined, 49, false, []],
      [null, undefined, 50, false, ["[host tool-call elapsed: 0.1s]"]],
      [null, undefined, 0, true, ["[host tool-call elapsed: 0.0s]"]],
      [null, "0", 0, false, ["[host tool-call elapsed: 0.0s]"]],
      ["0", "60000", 0, false, ["[host tool-call elapsed: 0.0s]"]],
      ["invalid", "0", 0, false, ["[host tool-call elapsed: 0.0s]"]],
      ["invalid", "invalid", 49, false, []],
    ] as const) {
      if (env === undefined) {
        delete process.env.PI_TOOL_DURATION_THRESHOLD_MS;
      } else {
        process.env.PI_TOOL_DURATION_THRESHOLD_MS = env;
      }
      const sessionManager = SessionManager.inMemory();
      sessionManager.appendMessage(assistantCalls("call"));
      const fire = loadExtension(sessionManager, flag);
      await fire("tool_execution_start")({ type: "tool_execution_start", toolCallId: "call" });
      clock += elapsed;
      await fire("tool_execution_end")({ type: "tool_execution_end", toolCallId: "call", isError });
      const message: ToolResultMessage = { ...toolMessage("call").message, isError };
      await fire("message_end")({ type: "message_end", message });
      sessionManager.appendMessage(message);
      const [, annotated] = modelContext(fire, sessionManager);
      assert.ok(annotated);
      assert.deepEqual(
        texts(annotated),
        [...expected],
        JSON.stringify({ flag, env, elapsed, isError }),
      );
    }
  },
);
