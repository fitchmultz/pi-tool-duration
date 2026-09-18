/**
 * pi-tool-duration
 *
 * Appends `[duration: Xs]` to slow or failed tool messages so the model sees
 * how long a call actually took. pi already measures this for the TUI
 * ("Took Xs") but the model does not see that timing.
 */
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_THRESHOLD_MS = 1000;
const TIMING_ENTRY = "pi-tool-duration";

type SavedTiming = { toolCallId: string; timestamp: number; duration: string };

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

function withDurations(
  messages: ContextEvent["messages"],
  ctx: ExtensionContext,
  position: "append" | "prepend" = "append",
) {
  const saved = new Map<string, string>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== TIMING_ENTRY) continue;
    const timing = entry.data as SavedTiming | undefined;
    if (
      typeof timing?.toolCallId !== "string" ||
      typeof timing.timestamp !== "number" ||
      typeof timing.duration !== "string"
    ) continue;
    saved.set(`${timing.timestamp}:${timing.toolCallId}`, timing.duration);
  }

  return messages.map((message) => {
    if (message.role !== "toolResult") return message;
    const duration = saved.get(`${message.timestamp}:${message.toolCallId}`);
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

  pi.on("tool_execution_end", (event) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) return;

    const ms = performance.now() - startedAt;
    if (!event.isError && ms < thresholdMs(pi)) return;
    durations.set(event.toolCallId, `[duration: ${(ms / 1000).toFixed(1)}s]`);
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

  pi.on("context", (event, ctx) => ({ messages: withDurations(event.messages, ctx) }));

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
  pi.on("session_shutdown", clearTimings);
  pi.on("agent_end", clearTimings);
  pi.on("agent_settled", clearTimings);
}
