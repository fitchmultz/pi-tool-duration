/**
 * pi-tool-duration
 *
 * Appends `[duration: Xs]` to tool results so the model sees how long a call
 * actually took. pi already measures this for the TUI ("Took Xs") but never
 * sends it to the model — so a 1000s command looks identical to a 1s one.
 *
 * Rule: annotate every tool (bash, read, edit, MCP, subagent, ...) only when
 * the run is >= THRESHOLD_MS. Silent on instant calls = clean signal, no noise.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: hardcoded threshold; make configurable (flag/settings) if needed
const THRESHOLD_MS = 3000;

const starts = new Map<string, number>();

export default function (pi: ExtensionAPI) {
  // tool_call fires before execution; tool_result fires after (even on error),
  // same toolCallId. Returning { content } replaces what the LLM sees.
  pi.on("tool_call", async (event) => {
    starts.set(event.toolCallId, Date.now());
  });

  pi.on("tool_result", async (event) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) return;

    const ms = Date.now() - startedAt;
    if (ms < THRESHOLD_MS) return;

    return {
      content: [
        ...event.content,
        { type: "text" as const, text: `[duration: ${(ms / 1000).toFixed(1)}s]` },
      ],
    };
  });

  // Reclaim starts for tools blocked/aborted mid-call (tool_result never fires
  // for them, so they'd otherwise leak). agent_end bounds every turn.
  pi.on("agent_end", async () => {
    starts.clear();
  });
}
