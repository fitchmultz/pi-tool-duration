# pi-tool-duration

Appends `[duration: Xs]` to tool results so the model knows how long a command
actually took.

```
$ npm run build
<output>
Command exited with code 0
[duration: 1034.0s]
```

## Why

pi already measures every command's duration and shows `Took Xs` in the TUI —
but that number never reaches the model. So to the agent, a 1000-second command
looks identical to a 1-second one. It can't tell "fast, nothing changed" from
"slow, something is wrong." This puts the elapsed seconds next to the exit code,
where the model can reason about it directly.

## How it works

`tool_call` and `tool_result` are matched extension events that share a
`toolCallId` and fire immediately before/after a tool runs (the result fires
even on error or timeout). Returning `{ content }` from `tool_result` replaces
the text the model receives, so the duration is recorded into the message once,
at the source.

**Every tool** — bash, read, edit, write, grep, find, ls, MCP tools, subagents
— is annotated when its run is `>= THRESHOLD_MS`. Instant calls stay silent for a
clean signal; only slow runs (the ones that matter) get stamped.

## Install

```bash
pi install ./pi-tool-duration      # local
# or after publishing
pi install npm:pi-tool-duration
```

## Try without installing

```bash
pi -e ./pi-tool-duration
```

## Verify

In a session running the extension:

```bash
bash: sleep 5; echo hi
```

The model sees:

```
hi
[duration: 5.0s]
```

An instant command stays silent:

```bash
bash: echo fast
```

The TUI continues to show its own `Took X.Xs`; the model now sees `[duration: ...]`
on slow runs too.

## Configure

Edit `THRESHOLD_MS` in `extensions/tool-duration/index.ts`. Set it to `0` to
annotate every tool on every run.

## License

MIT
