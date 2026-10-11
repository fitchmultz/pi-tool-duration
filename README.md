# pi-tool-duration

`pi-tool-duration` adds elapsed time to the tool results Pi sends to the model. That gives the model context about slow commands and failed calls, while your terminal keeps Pi's usual output.

![A Pi tool call is timed, its model-visible result gets an elapsed-time marker, and the terminal keeps its native output.](.github/readme/tool-timing.png)

*Pi measures each call, saves the timing in the session, and adds it only to the copy the model receives.*

## Install

Requires **Pi 1.0.0+** and **Node.js 24+**. Tested with official Pi and the maintained [`fitchmultz/pi` fork](https://github.com/fitchmultz/pi).

```bash
pi install npm:pi-tool-duration
pi
```

Already running Pi? Use `/reload` to load the extension. You can also [install from Git or try a local checkout](docs/development.md#local-setup).

[Try a timed call](#try-it) below, or [adjust which calls get a timing marker](#configure).

## Try it

Ask Pi:

```text
Use bash to run: sleep 1; echo hi
```

The model gets a result like this. The exact time depends on the call:

```text
hi
[host tool-call elapsed: 1.0s]
```

You still see Pi's native tool rendering in the terminal. The extension adds no extra timing line there.

By default, successful calls taking **50 ms or more** get a marker. Faster successful calls stay unchanged because they would round to `0.0s`. Failed calls get a marker regardless of the threshold, when Pi observed their start and end.

## Configure

Set a threshold when starting Pi:

```bash
# Include even instant calls.
PI_TOOL_DURATION_THRESHOLD_MS=0 pi

# Include successful calls taking at least a second, plus failed calls.
PI_TOOL_DURATION_THRESHOLD_MS=1000 pi

# A valid CLI value overrides the environment variable.
pi --tool-duration-threshold-ms 500
```

Use a non-negative number of milliseconds. If the CLI value is invalid, the extension tries the environment variable, then the 50 ms default. Failed calls still get a marker.

## How it works

The extension times each call from Pi's execution-start event to its execution-end event and rounds to tenths of a second. It saves the timing separately in the session, so recorded tool text, details, and images stay intact.

The time includes preflight and result processing. Parallel calls can overlap, so don't add their times together to measure the whole task. For a tool that starts a background job, the marker covers the launch call.

Saved timings survive reload, resume, forks, branch navigation, and retained compaction history. Generated summaries can leave out individual timings.

Built-in and extension tools with Pi execution events are covered. Direct `!` / `!!` commands and RPC `bash` messages aren't tool results, so they don't get markers.

The [timing reference](docs/reference.md) covers the measurement boundaries, history matching, compaction, and OpenAI Responses setup.

## More

[Development](docs/development.md) · [Release procedure](docs/development.md#automatic-npm-releases) · [Changelog](CHANGELOG.md) · [Report a problem](https://github.com/fitchmultz/pi-tool-duration/issues)

## License

[MIT](LICENSE) · Mitch Fultz
