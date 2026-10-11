# Timing reference

[Back to the README](../README.md)

## Measurement boundaries

The extension measures from Pi's `tool_execution_start` through `tool_execution_end` using a monotonic clock. It saves the timing in a hidden session entry and appends one text block to the model-request copy of the result. Durations are rounded to tenths of a second.

The measurement includes preflight and result processing. In a parallel batch, it can include time spent preparing later siblings, but stops when this call finishes even if another call continues. For a tool that launches a background job, it measures the launch call. Parallel durations are not additive task elapsed time.

Built-in and extension tools that emit Pi execution events are covered when their results appear in the transcript. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

Recorded tool content, details, images, and native terminal rendering stay unchanged. Tool output resembling a timing marker is never removed or rewritten.

## Thresholds

The default threshold is **50 ms**. Faster successful calls would read `0.0s`, so they stay unannotated. Failed calls with observed start and end events are annotated regardless of the threshold.

The extension accepts non-negative, finite numeric values, including fractional milliseconds. A valid `--tool-duration-threshold-ms` value takes precedence over `PI_TOOL_DURATION_THRESHOLD_MS`. Invalid CLI values fall through to the environment value; invalid environment values fall back to the default. A successful result below a configured threshold stays unchanged. Missing timing does not establish a zero-duration call.

See [configuration examples](../README.md#configure).

## Session history and matching

Timings survive reload, resume, forks, branch navigation, and retained compaction history. The first timing lookup on a branch replays its ancestry once, including legacy records before compaction. Subsequent requests reuse occurrence-specific timing or known-absent answers and process only new entries. Unknown or orphan results do not repeat full-history walks.

Reused call IDs with the same finalized timestamp retain an ordered occurrence queue; distinct result content can identify filtered copies. Request messages do not carry entry IDs, so indistinguishable filtered copies align to the newest retained occurrences. Navigation or session replacement rebuilds the selected branch; no history cap discards timing. Historical markers keep their original text.

## Compaction

Both compaction input arrays are annotated together in chronological order. Timing goes before tool output in these copies so Pi's truncation preserves it in the summarizer's input. Generated summaries may omit individual timings. Native branch summaries exclude tool results.

## GPT-6 Astra and OpenAI Responses

Use Pi's native OpenAI or OpenAI Codex Responses provider. The extension uses `context_with_system` to preserve the positions of prompt and tool updates, allowing native caching and incremental requests to work.

Prefer Pi's built-in model definitions. To adjust a model's limits, use `modelOverrides`, described in [Pi's model documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#configure-a-compatible-endpoint), which preserves native compatibility metadata. A same-ID entry in `models` replaces that metadata.

Transport selection, reasoning settings, tool scheduling, and request-boundary steering remain Pi's responsibility. The extension does not alter provider requests or add model instructions.
