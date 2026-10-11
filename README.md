# pi-tool-duration

This Pi extension adds elapsed time to tool results that the model receives. Use it to give the model context about slow or failed tool calls.

![Pi runs a tool. The extension saves elapsed time and adds a marker to the model's copy. The terminal keeps its native output.](.github/readme/tool-timing.png)

*The extension saves elapsed time in the session. It adds a time marker to the model's copy of each eligible tool result.*

## Install

Use **Pi 1.0.0 or later** and **Node.js 24 or later**. Tests cover official Pi and the maintained [`fitchmultz/pi` fork](https://github.com/fitchmultz/pi).

```bash
pi install npm:pi-tool-duration
pi
```

Run `/reload` in an open Pi session to load the extension. Then [try a tool call](#try-it).

## Try it

Ask Pi to run this tool call:

```text
Use bash to run: sleep 1; echo hi
```

The model receives `hi` and a marker such as `[host tool-call elapsed: 1.0s]`. The marker reports elapsed time to tenths of a second.

## Configure

The default threshold is **50 ms**. Faster successful calls get no marker because their time would round to `0.0s`.

Failed calls get a marker at any threshold when Pi records their start and end.

Set the threshold when you start Pi:

```bash
# Include all observed tool results.
PI_TOOL_DURATION_THRESHOLD_MS=0 pi

# Include successful calls of at least one second and failed calls.
PI_TOOL_DURATION_THRESHOLD_MS=1000 pi

# Set a 500 ms threshold through the CLI.
pi --tool-duration-threshold-ms 500
```

Use a non-negative number of milliseconds. A valid CLI value takes precedence over the environment variable.

## Timing limits

The measurement includes preflight and result processing. Parallel calls can overlap. Do not add their durations to measure total task time.

A tool that starts a background job reports the duration of the launch call.

The extension leaves recorded tool output and terminal output unchanged.

Saved timings survive reload, resume, forks, branch navigation, and retained compaction history. A compaction summary can omit individual timings.

Direct `!` / `!!` commands and RPC `bash` messages are outside the scope of this extension.

## Details

Read the [timing reference](docs/reference.md) for measurement boundaries, history matching, compaction, and OpenAI Responses setup.

See [development and maintenance](docs/development.md) for Git installation, local setup, compatibility checks, and releases.

[Changelog](CHANGELOG.md) · [Report a problem](https://github.com/fitchmultz/pi-tool-duration/issues)

## License

[MIT](LICENSE) · Mitch Fultz
