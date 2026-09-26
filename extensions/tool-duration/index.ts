/**
 * pi-tool-duration
 *
 * Adds host-observed tool-call timing to model-request copies without
 * changing recorded tool output or Pi's native terminal rendering.
 */
import type {
  ContextWithSystemEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

type ToolResult = Extract<ContextWithSystemEvent["messages"][number], { role: "toolResult" }>;

// Maintained fork only; official Pi never emits these events.
declare module "@earendil-works/pi-coding-agent" {
  interface ExtensionAPI {
    /** Emitted instead of tool_execution_end when a native async call detaches; it later resumes with a new start. */
    on(
      event: "tool_execution_detached",
      handler: ExtensionHandler<{ type: "tool_execution_detached"; toolCallId: string }>,
    ): () => void;
    /** Supplies model-only content for a saved result sent on a live continuation, which skips context hooks. */
    on(
      event: "live_tool_result",
      handler: ExtensionHandler<{ type: "live_tool_result"; message: ToolResult }, { content?: ToolResult["content"] }>,
    ): () => void;
  }
}

const DEFAULT_THRESHOLD_MS = 0;
const TIMING_ENTRY = "pi-tool-duration";
const DETACHED_ENTRY = "pi-tool-duration-detached";

type SavedTiming = { toolCallId: string; timestamp: number; duration: string };
type DetachedSpan = { toolCallId: string; elapsedMs: number };

function parseThreshold(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function thresholdMs(pi: ExtensionAPI): number {
  return (
    parseThreshold(pi.getFlag("tool-duration-threshold-ms")) ??
    parseThreshold(process.env.PI_TOOL_DURATION_THRESHOLD_MS) ??
    DEFAULT_THRESHOLD_MS
  );
}

function timingKey(message: { timestamp: number; toolCallId: string }): string {
  return `${message.timestamp}:${message.toolCallId}`;
}

function* ancestry(ctx: ExtensionContext): Generator<SessionEntry> {
  for (let id = ctx.sessionManager.getLeafId(); id;) {
    const entry = ctx.sessionManager.getEntry(id);
    if (!entry) return;
    id = entry.parentId;
    yield entry;
  }
}

/** Call IDs issued by an original assistant message; the fork's checkpoint snapshots repeat them. */
function issuedCallIds(entry: SessionEntry): string[] {
  if (entry.type !== "message" || entry.message.role !== "assistant" || ("checkpoint" in entry && entry.checkpoint)) {
    return [];
  }
  return entry.message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []));
}

function detachedMs(ctx: ExtensionContext, toolCallId: string): number {
  let total = 0;
  for (const entry of ancestry(ctx)) {
    if (entry.type === "custom" && entry.customType === DETACHED_ENTRY) {
      const span = entry.data as DetachedSpan | undefined;
      if (span?.toolCallId === toolCallId && typeof span.elapsedMs === "number") total += span.elapsedMs;
    } else if (issuedCallIds(entry).includes(toolCallId)) {
      break;
    }
  }
  return total;
}

function withDurations(
  messages: ContextWithSystemEvent["messages"],
  ctx: ExtensionContext,
  position: "append" | "prepend" = "append",
) {
  const remaining = new Set(messages.filter((message) => message.role === "toolResult").map(timingKey));
  if (!remaining.size) return messages;

  const saved = new Map<string, string>();
  // Results published together can follow all of their timings, so match by call ID until the issuing message.
  const pending = new Map<string, string>();
  // ponytail: old or unknown results can scan the full ancestry; native timing metadata would remove this join.
  for (const entry of ancestry(ctx)) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const key = timingKey(entry.message);
      if (!remaining.has(key)) continue;
      // A reused call ID: the newer result had no timing between the two results.
      const newer = pending.get(entry.message.toolCallId);
      if (newer) remaining.delete(newer);
      pending.set(entry.message.toolCallId, key);
    } else if (entry.type === "custom" && entry.customType === TIMING_ENTRY) {
      const timing = entry.data as SavedTiming | undefined;
      if (
        typeof timing?.toolCallId !== "string" ||
        typeof timing.timestamp !== "number" ||
        typeof timing.duration !== "string"
      ) continue;
      // Match by call ID: another message_end handler may have replaced the result's timestamp.
      const key = pending.get(timing.toolCallId);
      if (!key) continue;
      saved.set(key, timing.duration);
      remaining.delete(key);
      pending.delete(timing.toolCallId);
    } else {
      for (const id of issuedCallIds(entry)) {
        const key = pending.get(id);
        if (!key) continue;
        remaining.delete(key);
        pending.delete(id);
      }
    }
    if (!remaining.size) break;
  }

  return messages.map((message) => {
    if (message.role !== "toolResult") return message;
    const duration = saved.get(timingKey(message));
    if (!duration) return message;
    const marker = { type: "text" as const, text: duration };
    return {
      ...message,
      content: position === "prepend" ? [marker, ...message.content] : [...message.content, marker],
    };
  });
}

export default function (pi: ExtensionAPI) {
  const starts = new Map<string, number>();
  const durations = new Map<string, string>();

  pi.registerFlag("tool-duration-threshold-ms", {
    // Pi's help formatter adds no separator once this long flag exceeds its 30-column width.
    description: " Minimum elapsed milliseconds before appending a model-visible duration",
    type: "string",
  });

  pi.on("tool_execution_start", (event) => {
    starts.set(event.toolCallId, performance.now());
  });

  pi.on("tool_execution_detached", (event) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) return;
    pi.appendEntry<DetachedSpan>(DETACHED_ENTRY, {
      toolCallId: event.toolCallId,
      elapsedMs: performance.now() - startedAt,
    });
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) return;

    // Detached waiting time is not observed, so only the measured active spans are summed.
    const ms = performance.now() - startedAt + detachedMs(ctx, event.toolCallId);
    if (!event.isError && ms < thresholdMs(pi)) return;
    durations.set(event.toolCallId, `[host tool-call elapsed: ${(ms / 1000).toFixed(1)}s]`);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "toolResult") return;
    const duration = durations.get(event.message.toolCallId);
    durations.delete(event.message.toolCallId);
    if (!duration) return;

    // Keep timing out of recorded tool content: Pi also uses it to rebuild the TUI.
    pi.appendEntry<SavedTiming>(TIMING_ENTRY, {
      toolCallId: event.message.toolCallId,
      timestamp: event.message.timestamp,
      duration,
    });
  });

  pi.on("context_with_system", (event, ctx) => ({ messages: withDurations(event.messages, ctx) }));

  pi.on("live_tool_result", ({ message }, ctx) => {
    const [timed] = withDurations([message], ctx);
    return timed !== message && timed?.role === "toolResult" ? { content: timed.content } : undefined;
  });

  pi.on("session_before_compact", ({ preparation }, ctx) => {
    // Native summarization bypasses context hooks and truncates tool text from the end.
    // Put timing first in its input copies, never in saved messages or ordinary requests.
    preparation.messagesToSummarize = withDurations(preparation.messagesToSummarize, ctx, "prepend");
    preparation.turnPrefixMessages = withDurations(preparation.turnPrefixMessages, ctx, "prepend");
  });

  const clearTimings = () => {
    starts.clear();
    durations.clear();
  };
  pi.on("session_start", clearTimings);
  pi.on("agent_end", clearTimings);
  pi.on("agent_settled", clearTimings);
}
