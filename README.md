# pi-tool-duration

Appends `[duration: Xs]` to slow Pi tool results so the model can tell when a tool actually took time.

```text
hi
[duration: 5.0s]
```

## Why

Pi already shows tool timing in the TUI (`Took Xs`), but that timing is UI-only. This extension adds the elapsed time to the model-visible tool result for slow calls.

## How it works

The extension measures from Pi's `tool_execution_start` through `tool_execution_end`. When elapsed time is at or above the configured threshold, or Pi marks the result as failed, it saves the timing in a hidden session entry. Before each model request, it appends one text block to that request's copy of the tool result:

```text
[duration: 5.0s]
```

Compaction input copies put timing before the tool output so it survives Pi's truncation of long results. Recorded tool output stays unchanged, including after reload, resume, and branch navigation. Timings remain available to the model across those transitions without duplicating Pi's native TUI timing such as `Took 5.0s`.

Markers already saved as tool text by versions through 0.2.1 remain unchanged. They cannot be safely distinguished from genuine tool output with the same text.

Scope: Pi tools that emit tool execution events, including built-ins and extension tools. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

Pi starts these timers during sequential tool-call preflight. In a parallel batch, a call's elapsed time can therefore include time spent preparing later siblings. This mirrors Pi's TUI timing.

## Install

Requires Pi 0.84.0 or later.

```bash
pi install .                         # local, global settings
pi install -l --approve .            # local, project settings
pi install npm:pi-tool-duration      # published package
```

## Try without installing

From this repo:

```bash
pi --no-extensions -e .
# or
pi --no-extensions -e ./extensions/tool-duration/index.ts
```

`--no-extensions` prevents a duplicate flag conflict when another copy is already installed.

## Configure

Default threshold: `1000` ms.

```bash
PI_TOOL_DURATION_THRESHOLD_MS=0 pi --no-extensions -e .   # annotate every tool result
pi --no-extensions -e . --tool-duration-threshold-ms 500  # annotate tools taking >= 500ms
```

Invalid values are ignored. An invalid CLI value falls through to the environment value; an invalid environment value falls back to the default.

## Verify

In a session running the extension, ask Pi to use bash:

```text
Use bash to run: sleep 5; echo hi
```

The model sees:

```text
hi
[duration: 5.0s]
```

A fast successful tool below the threshold stays unchanged. A failed tool result delivered to the model is always annotated, even below the threshold.

## Development

Run `npm ci --ignore-scripts` and `npm run check:compat` (typecheck, existing unit/native CLI tests, and pack dry-run). No production build or `prepare` is needed. The development host is pinned to official `0.87.0`. The installation requirements still document a `0.84.0` minimum; this compatibility matrix does not retest that older target. The host-provided Pi peer stays wildcard and optional rather than bundling a runtime.

The runtime tests use the installed host's manifest `bin.pi` entry, not an assumed `dist/cli.js`. `PI_HOST_CLI`, `PI_COMPAT_EXPECTED_VERSION`, and `PI_COMPAT_EXPECTED_PACKAGE_DIR` can assert the selected graph. The CLI suite talks only to its localhost scripted provider in an isolated HOME.

Set `PI_HOST_INDEX` to the selected host's absolute `dist/index.js` to include the native checkpoint/reload/restore regression. Missing checkpoint support is optional on official Pi, but fails when `PI_COMPAT_HOST=fork` (or `PI_REQUIRE_CHECKPOINT=1`). That regression preserves idle history and tool selection without model calls; it does not itself exercise a timing-bearing tool across cold restore.

## License

MIT
