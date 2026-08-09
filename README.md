# pi-tool-duration

Appends `[duration: Xs]` to slow Pi tool results so the model can tell when a tool actually took time.

```text
hi
[duration: 5.0s]
```

## Why

Pi already shows tool timing in the TUI (`Took Xs`), but that timing is UI-only. This extension adds the elapsed time to the model-visible tool result for slow calls.

## How it works

The extension measures from Pi's `tool_execution_start` through `tool_execution_end`. When elapsed time is at or above the configured threshold, or Pi marks the result as failed, it appends one text block to the finalized model-visible tool message:

```text
[duration: 5.0s]
```

This leaves Pi's TUI output unchanged, so built-in timing such as `Took 5.0s` is not duplicated. Scope: Pi tools that emit tool execution events, including built-ins and extension tools. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

Pi starts these timers during sequential tool-call preflight. In a parallel batch, a call's elapsed time can therefore include time spent preparing later siblings. This mirrors Pi's TUI timing.

## Install

Requires Pi 0.84.0 or later.

```bash
pi install .                         # local, global settings
pi install -l --approve .            # local, project settings
pi install npm:pi-tool-duration      # after npm publish
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

## License

MIT
