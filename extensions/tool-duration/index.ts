/**
 * pi-tool-duration
 *
 * Appends `[duration: Xs]` to slow tool results so the model sees how long a
 * call actually took. pi already measures this for the TUI ("Took Xs") but the
 * model does not see that timing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_THRESHOLD_MS = 1000;
const DURATION_RE = /^\[duration: \d+(?:\.\d+)?s\]$/;

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

function alreadyAnnotated(content: Array<{ type: string; text?: string }>): boolean {
  const last = content.at(-1);
  return last?.type === "text" && typeof last.text === "string" && DURATION_RE.test(last.text);
}

export default function (pi: ExtensionAPI) {
  const starts = new Map<string, number>();

  pi.registerFlag("tool-duration-threshold-ms", {
    description: "Minimum tool duration in milliseconds before appending [duration: Xs] to the model-visible result",
    type: "string",
  });

  pi.on("tool_call", async (event) => {
    starts.set(event.toolCallId, performance.now());
  });

  pi.on("tool_result", async (event) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) return;

    const ms = performance.now() - startedAt;
    if (ms < thresholdMs(pi) || alreadyAnnotated(event.content)) return;

    return {
      content: [
        ...event.content,
        { type: "text" as const, text: `[duration: ${(ms / 1000).toFixed(1)}s]` },
      ],
    };
  });

  const clearStarts = () => starts.clear();
  pi.on("session_start", clearStarts);
  pi.on("session_shutdown", clearStarts);
  pi.on("agent_end", clearStarts);
}
