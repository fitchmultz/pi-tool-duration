/**
 * pi-tool-duration
 *
 * Adds host-observed tool-call timing to model-request copies without
 * changing recorded tool output or Pi's native terminal rendering.
 */
import { isDeepStrictEqual } from "node:util";
import type {
  ContextWithSystemEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// Successful calls under 50 ms would read "0.0s" at tenth-of-a-second precision.
const DEFAULT_THRESHOLD_MS = 50;
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

function timingKey(message: { timestamp: number; toolCallId: string }): string {
  return `${message.timestamp}:${message.toolCallId}`;
}

// Retain only small join facts, never tool output or assistant signatures.
type TimingFact = {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  checkpoint?: boolean;
  message?: { role: string; timestamp?: number; toolCallId?: string; toolCalls?: readonly { id: string }[] };
};

function timingLookup() {
  let manager: ExtensionContext["sessionManager"] | undefined;
  let leaf: string | null = null;
  const saved = new Map<string, { entryId: string; duration?: string }[]>();
  const pending = new Map<string, string>();

  function reset() {
    manager = undefined;
    leaf = null;
    saved.clear();
    pending.clear();
  }

  function reconcile(ctx: ExtensionContext) {
    const sm = ctx.sessionManager;
    if (manager !== sm) reset();
    const nextLeaf = sm.getLeafId();
    if (manager === sm && nextLeaf === leaf) return;
    function* ancestry(): Generator<TimingFact> {
      for (let id = nextLeaf; id;) {
        const entry = sm.getEntry(id);
        if (!entry) break;
        const fact: TimingFact = {
          id: entry.id, parentId: entry.parentId, type: entry.type,
          checkpoint: "checkpoint" in entry && Boolean(entry.checkpoint),
        };
        if (entry.type === "custom") fact.customType = entry.customType;
        if (entry.type === "message") {
          const message = entry.message;
          if (message.role === "assistant") fact.message = {
            role: message.role,
            toolCalls: message.content.flatMap(block => block.type === "toolCall" ? [{ id: block.id }] : []),
          };
          else if (message.role === "toolResult") fact.message = {
            role: message.role, timestamp: message.timestamp, toolCallId: message.toolCallId,
          };
        }
        yield fact;
        id = entry.parentId;
      }
    }
    const suffix: TimingFact[] = [];
    let anchored = leaf === null;
    for (const entry of ancestry()) {
      if (entry.id === leaf) { anchored = true; break; }
      suffix.push(entry);
      // Official parent lookups are O(1); do not decode the already indexed anchor.
      if (entry.parentId === leaf) { anchored = true; break; }
    }
    if (!anchored) { saved.clear(); pending.clear(); }
    // ponytail: cold legacy recovery/navigation is O(P) once, with small facts only;
    // an indexed native timing field could remove that replay without losing old markers.
    for (const entry of suffix.reverse()) {
      if (entry.type === "custom" && entry.customType === TIMING_ENTRY) {
        const record = sm.getEntry(entry.id);
        const timing = record?.type === "custom" ? record.data as SavedTiming | undefined : undefined;
        if (typeof timing?.toolCallId === "string" && typeof timing.timestamp === "number" && typeof timing.duration === "string") {
          pending.set(timing.toolCallId, timing.duration);
        }
      } else if (entry.type === "message" && entry.message?.role === "assistant" && !entry.checkpoint) {
        for (const call of entry.message.toolCalls ?? []) pending.delete(call.id);
      } else if (entry.type === "message" && entry.message?.role === "toolResult") {
        const { toolCallId, timestamp } = entry.message;
        if (typeof toolCallId !== "string" || typeof timestamp !== "number") continue;
        const key = timingKey({ toolCallId, timestamp });
        const occurrences = saved.get(key) ?? [];
        occurrences.push({ entryId: entry.id, duration: pending.get(toolCallId) });
        saved.set(key, occurrences);
        pending.delete(toolCallId);
      }
    }
    manager = sm;
    leaf = nextLeaf;
  }

  function annotate(messages: ContextWithSystemEvent["messages"], position: "append" | "prepend" = "append") {
    const remaining = new Map<string, number>();
    for (const message of messages) if (message.role === "toolResult") {
      const key = timingKey(message);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const used = new Set<string>();
    return messages.map(message => {
      if (message.role !== "toolResult") return message;
      const key = timingKey(message);
      const occurrences = saved.get(key);
      let occurrence = occurrences?.[0];
      if (occurrences && occurrences.length > 1) {
        const available = occurrences.filter(item => !used.has(item.entryId));
        const matches = available.filter(item => {
          const entry = manager?.getEntry(item.entryId);
          return entry?.type === "message" && entry.message.role === "toolResult"
            && isDeepStrictEqual(entry.message.content, message.content);
        });
        // ponytail: request copies omit entry IDs; indistinguishable filtered copies
        // align to newest retained occurrences until Pi exposes request occurrence IDs.
        occurrence = matches.length === 1 ? matches[0] : available[Math.max(0, available.length - (remaining.get(key) ?? 0))];
      }
      if (occurrence) used.add(occurrence.entryId);
      remaining.set(key, (remaining.get(key) ?? 1) - 1);
      const duration = occurrence?.duration;
      if (!duration) return message;
      const marker = { type: "text" as const, text: duration };
      return { ...message, content: position === "prepend" ? [marker, ...message.content] : [...message.content, marker] };
    });
  }
  return { reset, reconcile, annotate };
}

export default function (pi: ExtensionAPI) {
  const lookup = timingLookup();
  const starts = new Map<string, number>();
  const durations = new Map<string, string>();

  pi.registerFlag("tool-duration-threshold-ms", {
    // Pi's help formatter adds no separator once this long flag exceeds its 30-column width.
    description: " Minimum elapsed milliseconds before appending a model-visible duration (default 50)",
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

  pi.on("context_with_system", (event, ctx) => {
    if (!event.messages.some(message => message.role === "toolResult")) return;
    lookup.reconcile(ctx);
    return { messages: lookup.annotate(event.messages) };
  });

  pi.on("session_before_compact", ({ preparation }, ctx) => {
    // Native summarization bypasses context hooks and truncates tool text from the end.
    // Put timing first in its input copies, never in saved messages or ordinary requests.
    if (!preparation.messagesToSummarize.some(message => message.role === "toolResult") &&
        !preparation.turnPrefixMessages.some(message => message.role === "toolResult")) return;
    lookup.reconcile(ctx);
    const cut = preparation.messagesToSummarize.length;
    const messages = lookup.annotate([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages], "prepend");
    preparation.messagesToSummarize = messages.slice(0, cut);
    preparation.turnPrefixMessages = messages.slice(cut);
  });

  const clearTimings = () => {
    starts.clear();
    durations.clear();
  };
  pi.on("session_start", () => { clearTimings(); lookup.reset(); });
  pi.on("session_tree", () => { clearTimings(); lookup.reset(); });
  pi.on("agent_end", clearTimings);
  pi.on("agent_settled", clearTimings);
}
