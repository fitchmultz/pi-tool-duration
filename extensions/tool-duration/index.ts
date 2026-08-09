/**
 * pi-tool-duration
 *
 * Appends `[duration: Xs]` to slow or failed tool messages so the model sees
 * how long a call actually took. pi already measures this for the TUI
 * ("Took Xs") but the model does not see that timing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_THRESHOLD_MS = 1000;

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

export default function (pi: ExtensionAPI) {
  const starts = new Map<string, number>();
  const durations = new Map<string, string>();

  pi.registerFlag("tool-duration-threshold-ms", {
    description: "Minimum tool duration in milliseconds before appending [duration: Xs] to the model-visible result",
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

    return {
      message: {
        ...event.message,
        content: [...event.message.content, { type: "text" as const, text: duration }],
      },
    };
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
