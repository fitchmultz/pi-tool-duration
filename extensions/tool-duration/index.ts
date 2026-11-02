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
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

// Successful calls under 50 ms would read "0.0s" at tenth-of-a-second precision.
const DEFAULT_THRESHOLD_MS = 50;
const TIMING_ENTRY = "pi-tool-duration";

type SavedTiming = { toolCallId: string; timestamp: number; duration: string };

type RequestMessage = ContextWithSystemEvent["messages"][number];
type RequestToolResult = Extract<RequestMessage, { role: "toolResult" }>;
type ResultBlock = RequestToolResult["content"][number];

// Retain only small join facts, never tool output or assistant signatures.
type TimingFact = {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  checkpoint?: boolean;
  message?: {
    role: string;
    timestamp?: number;
    toolCallId?: string;
    toolCalls?: readonly { id: string }[];
  };
};

type TimingOccurrence = { entryId: string; duration: string | undefined };

type SessionManager = ExtensionContext["sessionManager"];

/** The Pi API surface this extension consumes. */
type PiHost = Pick<ExtensionAPI, "on" | "registerFlag" | "getFlag" | "appendEntry">;

type LookupState = {
  manager: SessionManager | undefined;
  leaf: string | null;
  saved: Map<string, TimingOccurrence[]>;
  pending: Map<string, string>;
};

type TimingLookup = {
  reset: () => void;
  reconcile: (ctx: ExtensionContext) => void;
  annotate: (
    messages: ContextWithSystemEvent["messages"],
    position?: "append" | "prepend",
  ) => ContextWithSystemEvent["messages"];
};

function parseThreshold(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function thresholdMs(pi: Pick<ExtensionAPI, "getFlag">): number {
  return (
    parseThreshold(pi.getFlag("tool-duration-threshold-ms")) ??
    parseThreshold(process.env.PI_TOOL_DURATION_THRESHOLD_MS) ??
    DEFAULT_THRESHOLD_MS
  );
}

function timingKey(message: { timestamp: number; toolCallId: string }): string {
  return `${message.timestamp}:${message.toolCallId}`;
}

function isSavedTiming(value: unknown): value is SavedTiming {
  return (
    typeof value === "object" &&
    value !== null &&
    "toolCallId" in value &&
    typeof value.toolCallId === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "number" &&
    "duration" in value &&
    typeof value.duration === "string"
  );
}

function timingFact(entry: SessionEntry): TimingFact {
  const fact: TimingFact = {
    id: entry.id,
    parentId: entry.parentId,
    type: entry.type,
    checkpoint: "checkpoint" in entry && Boolean(entry.checkpoint),
  };
  if (entry.type === "custom") {
    fact.customType = entry.customType;
  } else if (entry.type === "message") {
    const message = entry.message;
    if (message.role === "assistant") {
      fact.message = {
        role: message.role,
        toolCalls: message.content.flatMap((block) =>
          block.type === "toolCall" ? [{ id: block.id }] : [],
        ),
      };
    } else if (message.role === "toolResult") {
      fact.message = {
        role: message.role,
        timestamp: message.timestamp,
        toolCallId: message.toolCallId,
      };
    }
  }
  return fact;
}

function* ancestryFacts(sm: SessionManager, leafId: string | null): Generator<TimingFact> {
  for (let id = leafId; id !== null;) {
    const entry = sm.getEntry(id);
    if (!entry) {
      break;
    }
    yield timingFact(entry);
    id = entry.parentId;
  }
}

function collectSuffix(
  state: LookupState,
  sm: SessionManager,
  nextLeaf: string | null,
): { suffix: TimingFact[]; anchored: boolean } {
  const suffix: TimingFact[] = [];
  let anchored = state.leaf === null;
  for (const entry of ancestryFacts(sm, nextLeaf)) {
    if (entry.id === state.leaf) {
      anchored = true;
      break;
    }
    suffix.push(entry);
    // Official parent lookups are O(1); do not decode the already indexed anchor.
    if (entry.parentId === state.leaf) {
      anchored = true;
      break;
    }
  }
  return { suffix, anchored };
}

function restorePendingTiming(state: LookupState, sm: SessionManager, entry: TimingFact): void {
  const record = sm.getEntry(entry.id);
  const data = record?.type === "custom" ? record.data : undefined;
  if (isSavedTiming(data)) {
    state.pending.set(data.toolCallId, data.duration);
  }
}

function forgetSupersededCalls(state: LookupState, entry: TimingFact): void {
  for (const call of entry.message?.toolCalls ?? []) {
    state.pending.delete(call.id);
  }
}

function recordResultOccurrence(state: LookupState, entry: TimingFact): void {
  const message = entry.message;
  if (message === undefined) {
    return;
  }
  const { toolCallId, timestamp } = message;
  if (typeof toolCallId !== "string" || typeof timestamp !== "number") {
    return;
  }
  const key = timingKey({ toolCallId, timestamp });
  const occurrences = state.saved.get(key) ?? [];
  occurrences.push({ entryId: entry.id, duration: state.pending.get(toolCallId) });
  state.saved.set(key, occurrences);
  state.pending.delete(toolCallId);
}

function replayMessageFact(state: LookupState, entry: TimingFact): void {
  if (entry.message?.role === "assistant" && entry.checkpoint !== true) {
    forgetSupersededCalls(state, entry);
  } else if (entry.message?.role === "toolResult") {
    recordResultOccurrence(state, entry);
  }
}

function replaySuffix(state: LookupState, sm: SessionManager, suffix: TimingFact[]): void {
  // ponytail: cold legacy recovery/navigation is O(P) once, with small facts only;
  // an indexed native timing field could remove that replay without losing old markers.
  for (const entry of suffix.reverse()) {
    if (entry.type === "custom" && entry.customType === TIMING_ENTRY) {
      restorePendingTiming(state, sm, entry);
    } else if (entry.type === "message") {
      replayMessageFact(state, entry);
    }
  }
}

function clearLookup(state: LookupState): void {
  state.saved.clear();
  state.pending.clear();
}

type AnnotationContext = {
  state: LookupState;
  used: Set<string>;
  remaining: Map<string, number>;
};

function countRemainingCopies(messages: ContextWithSystemEvent["messages"]): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "toolResult") {
      const key = timingKey(message);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
  }
  return remaining;
}

function isMatchingOccurrence(
  ctx: AnnotationContext,
  item: TimingOccurrence,
  message: RequestToolResult,
): boolean {
  const entry = ctx.state.manager?.getEntry(item.entryId);
  return (
    entry?.type === "message" &&
    entry.message.role === "toolResult" &&
    isDeepStrictEqual(entry.message.content, message.content)
  );
}

function countMatchingCopies(
  messages: ContextWithSystemEvent["messages"],
  fromIndex: number,
  key: string,
  content: RequestToolResult["content"],
): number {
  let copies = 0;
  for (let index = fromIndex; index < messages.length; index++) {
    const copy = messages[index];
    if (
      copy?.role === "toolResult" &&
      timingKey(copy) === key &&
      isDeepStrictEqual(copy.content, content)
    ) {
      copies++;
    }
  }
  return copies;
}

function disambiguateOccurrence(
  ctx: AnnotationContext,
  messages: ContextWithSystemEvent["messages"],
  index: number,
  message: RequestToolResult,
): TimingOccurrence | undefined {
  const key = timingKey(message);
  const occurrences = ctx.state.saved.get(key);
  if (occurrences === undefined || occurrences.length === 1) {
    return occurrences?.[0];
  }
  const available = occurrences.filter((item) => !ctx.used.has(item.entryId));
  const matches = available.filter((item) => isMatchingOccurrence(ctx, item, message));
  // ponytail: request copies omit entry IDs; indistinguishable filtered copies
  // align to newest retained occurrences until Pi exposes request occurrence IDs.
  const candidates = matches.length > 0 ? matches : available;
  const fallback = ctx.remaining.get(key) ?? 0;
  const copiesRemaining =
    matches.length > 0 ? countMatchingCopies(messages, index, key, message.content) : fallback;
  return candidates[Math.max(0, candidates.length - copiesRemaining)];
}

function withDurationMarker(
  message: RequestToolResult,
  duration: string | undefined,
  position: "append" | "prepend",
): RequestMessage {
  if (duration === undefined) {
    return message;
  }
  const marker: ResultBlock = { type: "text", text: duration };
  const content =
    position === "prepend" ? [marker, ...message.content] : [...message.content, marker];
  return { ...message, content };
}

function annotateLookup(
  state: LookupState,
  messages: ContextWithSystemEvent["messages"],
  position: "append" | "prepend",
): ContextWithSystemEvent["messages"] {
  const ctx: AnnotationContext = {
    state,
    used: new Set<string>(),
    remaining: countRemainingCopies(messages),
  };
  return messages.map((message, index) => {
    if (message.role !== "toolResult") {
      return message;
    }
    const occurrence = disambiguateOccurrence(ctx, messages, index, message);
    if (occurrence !== undefined) {
      ctx.used.add(occurrence.entryId);
    }
    const key = timingKey(message);
    ctx.remaining.set(key, (ctx.remaining.get(key) ?? 1) - 1);
    return withDurationMarker(message, occurrence?.duration, position);
  });
}

function timingLookup(): TimingLookup {
  const state: LookupState = {
    manager: undefined,
    leaf: null,
    saved: new Map(),
    pending: new Map(),
  };
  const reset = () => {
    clearLookup(state);
    state.manager = undefined;
    state.leaf = null;
  };
  const reconcile = (ctx: ExtensionContext): void => {
    const sm = ctx.sessionManager;
    if (state.manager !== sm) {
      reset();
    }
    const nextLeaf = sm.getLeafId();
    if (state.manager === sm && nextLeaf === state.leaf) {
      return;
    }
    const { suffix, anchored } = collectSuffix(state, sm, nextLeaf);
    if (!anchored) {
      clearLookup(state);
    }
    replaySuffix(state, sm, suffix);
    state.manager = sm;
    state.leaf = nextLeaf;
  };
  return {
    reset,
    reconcile,
    annotate: (messages, position = "append") => annotateLookup(state, messages, position),
  };
}

export default function (pi: PiHost): void {
  const lookup = timingLookup();
  const starts = new Map<string, number>();
  const durations = new Map<string, string>();

  pi.registerFlag("tool-duration-threshold-ms", {
    // Pi's help formatter adds no separator once this long flag exceeds its 30-column width.
    description:
      " Minimum elapsed milliseconds before appending a model-visible duration (default 50)",
    type: "string",
  });

  pi.on("tool_execution_start", (event) => {
    starts.set(event.toolCallId, performance.now());
  });

  pi.on("tool_execution_end", (event) => {
    const startedAt = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    if (startedAt === undefined) {
      return;
    }

    const ms = performance.now() - startedAt;
    if (!event.isError && ms < thresholdMs(pi)) {
      return;
    }
    durations.set(event.toolCallId, `[host tool-call elapsed: ${(ms / 1000).toFixed(1)}s]`);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "toolResult") {
      return;
    }
    const duration = durations.get(event.message.toolCallId);
    durations.delete(event.message.toolCallId);
    if (duration === undefined) {
      return;
    }

    // Keep timing out of recorded tool content: Pi also uses it to rebuild the TUI.
    pi.appendEntry<SavedTiming>(TIMING_ENTRY, {
      toolCallId: event.message.toolCallId,
      timestamp: event.message.timestamp,
      duration,
    });
  });

  pi.on("context_with_system", (event, ctx) => {
    if (!event.messages.some((message) => message.role === "toolResult")) {
      return;
    }
    lookup.reconcile(ctx);
    return { messages: lookup.annotate(event.messages) };
  });

  pi.on("session_before_compact", ({ preparation }, ctx) => {
    // Native summarization bypasses context hooks and truncates tool text from the end.
    // Put timing first in its input copies, never in saved messages or ordinary requests.
    if (
      !preparation.messagesToSummarize.some((message) => message.role === "toolResult") &&
      !preparation.turnPrefixMessages.some((message) => message.role === "toolResult")
    ) {
      return;
    }
    lookup.reconcile(ctx);
    const cut = preparation.messagesToSummarize.length;
    const messages = lookup.annotate(
      [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages],
      "prepend",
    );
    // oxlint-disable-next-line no-param-reassign -- QX-002: Pi reads these arrays back from the same preparation object; returning a replacement is not part of the session_before_compact contract.
    preparation.messagesToSummarize = messages.slice(0, cut);
    // oxlint-disable-next-line no-param-reassign -- QX-002: Pi reads these arrays back from the same preparation object; returning a replacement is not part of the session_before_compact contract.
    preparation.turnPrefixMessages = messages.slice(cut);
  });

  const clearTimings = () => {
    starts.clear();
    durations.clear();
  };
  pi.on("session_start", () => {
    clearTimings();
    lookup.reset();
  });
  pi.on("session_tree", () => {
    clearTimings();
    lookup.reset();
  });
  pi.on("agent_end", clearTimings);
  pi.on("agent_settled", clearTimings);
}
