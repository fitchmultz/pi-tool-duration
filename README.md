# pi-tool-duration

Makes host-observed tool-call timing visible to the model without changing Pi's terminal output.

```text
hi
[host tool-call elapsed: 5.0s]
```

Every completed tool result is annotated by default. An optional threshold limits successful-call annotations; failed calls are always annotated.

## How it works

The extension measures from Pi's `tool_execution_start` through `tool_execution_end` using a monotonic clock. It saves the timing in a hidden session entry and appends one text block to the model-request copy of the result. Durations are rounded to tenths of a second.

The measurement includes preflight and result processing. In a parallel batch, it can include time spent preparing later siblings, but stops when this call finishes even if another call continues. For a tool that launches a background job, it measures the launch call. Parallel durations are not additive task elapsed time.

Recorded tool content, details, images, and native terminal rendering stay unchanged. Timings survive reload, resume, forks, branch navigation, and retained compaction history. Request-time lookup walks backward only as far as needed to find the visible results and their preceding timing records; older or unidentifiable results can require a longer walk.

Compaction input copies put timing before tool output so Pi's truncation preserves it in the summarizer's input. Generated summaries may omit individual timings. Native branch summaries exclude tool results. Historical markers keep their original text, and tool output resembling a marker is never removed or rewritten.

Scope: built-in and extension tools that emit Pi execution events. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

## Install

Requires Pi **0.87.0 or later**. Tested against official Pi and the maintained `fitchmultz/pi` fork.

```bash
pi install npm:pi-tool-duration
```

For local development:

```bash
pi install .                         # global settings
pi install -l --approve .            # project settings
pi --no-extensions -e .              # try without installing
```

`--no-extensions` prevents a duplicate flag conflict when another copy is already installed. Restart Pi after updating extension code; `/reload` reinitializes the loaded code but does not replace it.

## Configure

Default threshold: **0 ms**, including fast calls.

```bash
# Restore slow/failed-only reporting:
PI_TOOL_DURATION_THRESHOLD_MS=1000 pi --no-extensions -e .

# CLI value takes precedence:
pi --no-extensions -e . --tool-duration-threshold-ms 500
```

Invalid CLI values fall through to the environment value; invalid environment values fall back to zero. A successful result below a configured threshold stays unchanged. Missing timing does not establish a zero-duration call.

## GPT-6 Astra

Use Pi's native OpenAI or OpenAI Codex Responses provider. The extension uses `context_with_system` to preserve the positions of prompt and tool updates, allowing native caching and incremental requests to work.

Prefer Pi's built-in model definitions. To adjust a model's limits, use [`modelOverrides`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#per-model-overrides), which preserves native compatibility metadata. A same-ID entry in `models` replaces that metadata.

Transport selection, reasoning settings, asynchronous tool execution, and steering remain Pi's responsibility. The extension does not alter provider requests or add model instructions.

## Verify

Ask Pi to run a tool, for example:

```text
Use bash to run: sleep 1; echo hi
```

The model receives the output plus a host timing marker. Pi's terminal retains its native rendering.

## Development

Run `npm ci --ignore-scripts` and `npm run check:compat` for typechecking, unit/native runtime tests, and a pack dry-run. There is no production build or `prepare` step. The development host is pinned to official `0.87.0`; CI separately qualifies official Pi and the maintained fork. The host-provided Pi peer stays wildcard and optional rather than bundling a runtime.

Runtime tests use the installed host's manifest `bin.pi` entry and a local scripted Responses provider in an isolated HOME. `PI_HOST_CLI`, `PI_COMPAT_EXPECTED_VERSION`, and `PI_COMPAT_EXPECTED_PACKAGE_DIR` can assert the selected graph.

The restoration test uses the installed host by default; `PI_HOST_INDEX` can select another host's absolute `dist/index.js`. It executes a timed tool and verifies reload plus separate-process disk restoration on both hosts. Native checkpoint restoration also runs when available and is required when `PI_COMPAT_HOST=fork` or `PI_REQUIRE_CHECKPOINT=1`. These tests use local scripted model completions without provider network calls or credentials.

## License

MIT
