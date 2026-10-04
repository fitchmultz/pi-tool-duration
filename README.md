# pi-tool-duration

Makes host-observed tool-call timing visible to the model without changing Pi's terminal output.

```text
hi
[host tool-call elapsed: 5.0s]
```

By default, every tool result that took 50 ms or more is annotated. Faster successful calls would read `0.0s`, so they stay unannotated. Failed calls are always annotated.

## How it works

The extension measures from Pi's `tool_execution_start` through `tool_execution_end` using a monotonic clock. It saves the timing in a hidden session entry and appends one text block to the model-request copy of the result. Durations are rounded to tenths of a second.

The measurement includes preflight and result processing. In a parallel batch, it can include time spent preparing later siblings, but stops when this call finishes even if another call continues. For a tool that launches a background job, it measures the launch call. Parallel durations are not additive task elapsed time.

Recorded tool content, details, images, and native terminal rendering stay unchanged. Timings survive reload, resume, forks, branch navigation, and retained compaction history. The first timing lookup on a branch replays its ancestry once, including legacy records before compaction. Subsequent requests reuse occurrence-specific timing or known-absent answers and process only new entries. Unknown/orphan results do not repeat full-history walks. Reused call IDs with the same finalized timestamp retain an ordered occurrence queue; distinct result content can identify filtered copies. Request messages do not carry entry IDs, so indistinguishable filtered copies align to the newest retained occurrences. Both compaction arrays are annotated together in chronological order. Navigation or session replacement rebuilds the selected branch; no history cap discards timing.

Compaction input copies put timing before tool output so Pi's truncation preserves it in the summarizer's input. Generated summaries may omit individual timings. Native branch summaries exclude tool results. Historical markers keep their original text, and tool output resembling a marker is never removed or rewritten.

Scope: built-in and extension tools that emit Pi execution events. Direct `!` / `!!` shell commands and RPC `bash` command messages are not tool results and are not annotated.

## Install

Requires Pi **1.0.0 or later** on Node.js **24 or later**. Tested against official Pi and the maintained `fitchmultz/pi` fork.

```bash
pi install npm:pi-tool-duration
```

For local development:

```bash
pi install .                         # global settings
pi install -l --approve .            # project settings
pi --no-extensions -e .              # try without installing
```

`--no-extensions` prevents a duplicate flag conflict when another copy is already installed. On current Pi, `/reload` refreshes extension code; restart after dependency changes or on older hosts.

## Configure

Default threshold: **50 ms**, which skips successful calls that would read `0.0s`.

```bash
# Annotate every result, including instant calls:
PI_TOOL_DURATION_THRESHOLD_MS=0 pi --no-extensions -e .

# Slow/failed-only reporting:
PI_TOOL_DURATION_THRESHOLD_MS=1000 pi --no-extensions -e .

# CLI value takes precedence:
pi --no-extensions -e . --tool-duration-threshold-ms 500
```

Invalid CLI values fall through to the environment value; invalid environment values fall back to the 50 ms default. A successful result below a configured threshold stays unchanged. Missing timing does not establish a zero-duration call.

## GPT-6 Astra

Use Pi's native OpenAI or OpenAI Codex Responses provider. The extension uses `context_with_system` to preserve the positions of prompt and tool updates, allowing native caching and incremental requests to work.

Prefer Pi's built-in model definitions. To adjust a model's limits, use [`modelOverrides`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#per-model-overrides), which preserves native compatibility metadata. A same-ID entry in `models` replaces that metadata.

Transport selection, reasoning settings, tool scheduling, and request-boundary steering remain Pi's responsibility. The extension does not alter provider requests or add model instructions.

## Verify

Ask Pi to run a tool, for example:

```text
Use bash to run: sleep 1; echo hi
```

The model receives the output plus a host timing marker. Pi's terminal retains its native rendering.

For latest-host qualification, run `node /path/to/automation/scripts/qualify.mjs --repo pi-tool-duration --source "$PWD" --host official --target latest --output /tmp/pi-tool-duration-official`, then qualify the packed latest maintained fork with `--host fork --target /path/to/fork-package`. Plain `npm ci` checks only the locked development snapshot, not latest qualification.

## Automatic npm releases (maintainers)

Follow the [shared release procedure](https://github.com/fitchmultz/.github#automatic-npm-releases): merge a reviewed PR into `main` with an intentional `package.json` version bump and a matching versioned `CHANGELOG.md` section. Once configured and enabled, publication is unattended after the existing current-official/fork compatibility checks and candidate-tarball qualification pass. Complete any applicable package-specific release evidence before merging the bump. Automation never bumps versions, overwrites releases, or republishes an existing version; existing manual publisher instructions remain valid.

Failed/unpublished candidates can retry daily at 12:17 UTC or via manual dispatch of `npm release` on `main`, without another bump. Set repository variable `NPM_RELEASE_ENABLED` to anything other than `true` to stop new release plans; cancel pending runs separately when needed. Workflow validation is not evidence of a completed real OIDC publication.

## Development

Run `npm ci --ignore-scripts` and `npm run check` on Node.js 24 for typechecking, unit/native runtime tests, and an installed npm package smoke test. There is no production build or `prepare` step. Locked development dependencies are reproducible build snapshots, not qualification targets. CI tests the latest stable official release and latest maintained fork `main` on pull requests and weekly, resolving version/commit once per workflow run, selecting each complete host graph and retaining exact SDK/CLI evidence. The host-provided Pi peer stays wildcard and optional rather than bundling a runtime. The lockfile resolves every package from the public npm registry.

The lookup reconciles at the next read, after native message finalization and boundary drafts have committed. It does not register an extra `turn_end` handler merely to read IDs: official Pi eagerly builds full-branch boundary previews for those handlers, while the append suffix already provides finalized occurrence IDs and timestamps. Both 1.0 targets use official O(1) parent lookups; unsupported metadata/revision/checkpoint APIs from the former fork are not required or carried forward. Legacy checkpoint assistant copies remain readable without being mistaken for original issuing messages.

Runtime tests use the installed host's manifest `bin.pi` entry and a local scripted Responses provider in an isolated HOME. `PI_HOST_CLI`, `PI_COMPAT_EXPECTED_VERSION`, and `PI_COMPAT_EXPECTED_PACKAGE_DIR` can assert the selected graph.

The runtime and restoration tests use the installed host by default; `PI_HOST_INDEX` can select another host's absolute `dist/index.js`. They execute timed tools and verify reload plus separate-process disk restoration on both hosts. The maintained 1.0 fork no longer has native checkpoints; separate-process disk restoration is the portable recovery check. These tests use local scripted model completions without provider network calls or credentials.

## License

MIT
