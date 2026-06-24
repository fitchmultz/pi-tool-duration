# pi-tool-duration

Appends `[duration: Xs]` to slow Pi tool results so the model can tell when a tool actually took time.

```text
hi
[duration: 5.0s]
```

## Why

Pi already shows tool timing in the TUI (`Took Xs`), but that timing is UI-only. This extension adds the elapsed time to the model-visible tool result for slow calls.

## How it works

The extension matches Pi `tool_call` and `tool_result` events by `toolCallId`. When elapsed time is at or above the configured threshold, it appends one text block:

```text
[duration: 5.0s]
```

Scope: Pi tools that emit `tool_result` events, including built-ins and extension tools. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

## Install

```bash
pi install .                         # local, global settings
pi install -l --approve .            # local, project settings
pi install npm:pi-tool-duration      # after npm publish
```

## Try without installing

From this repo:

```bash
pi -e .
# or
pi -e ./extensions/tool-duration/index.ts
```

## Configure

Default threshold: `1000` ms.

```bash
PI_TOOL_DURATION_THRESHOLD_MS=0 pi -e .        # annotate every tool result
pi -e . --tool-duration-threshold-ms 500       # annotate tools taking >= 500ms
```

Invalid threshold values fall back to the default.

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

A fast command below the threshold stays unchanged.

## License

MIT
