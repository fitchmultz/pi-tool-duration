# Changelog

## [0.3.1] - 2026-09-22

### Fixed

- Use distinct native response IDs in compaction fixtures so unrelated tool calls cannot be mistaken for a single response. The runtime is unchanged from 0.3.0.

### Changed

- Qualify current Pi hosts with focused, artifact-free compatibility checks.

## [0.3.0] - 2026-09-21

### Changed

- Annotate every tool result by default with `[host tool-call elapsed: Xs]`. Set `PI_TOOL_DURATION_THRESHOLD_MS=1000` to retain slow/failed-only reporting.
- Require Pi 0.87.0 or later, using the same native extension APIs on official Pi and the maintained fork.
- Resolve timings through a stateless backward ancestry lookup instead of rebuilding the complete historical timing map for every request.

### Fixed

- Preserve prompt and tool updates in model context so duration annotations do not collapse the reusable request prefix.
- Associate timing with the finalized result when a later extension replaces its timestamp, preserving existing saved timing records.

### Tests

- Exercise native Responses serialization, dynamic prompt/tool prefixes, and finalized timestamps.
- Verify actual timed results through disk restoration and maintained-fork checkpoints.

## [0.2.3] - 2026-09-18

### Fixed

- Preserve timing in native compaction input when long tool output is truncated, including split-turn summaries. Ordinary requests still append one duration marker, and recorded tool content and details remain unchanged.

## [0.2.2] - 2026-09-18

### Fixed

- Keep duration markers out of terminal tool output after reload, resume, and branch navigation by storing timing in hidden session entries and annotating only model-request copies.
- Preserve model-visible timings across restoration, compaction summaries, and retained compaction history without changing tool content or details.

### Changed

- Verify recorded output, reload, restored timing, branch isolation, and repeated model requests in regression tests.
- Run clean-install checks on Node 22.19 and Node 24 in GitHub Actions.

## [0.2.1] - 2026-08-09

### Fixed

- Use Pi's error status instead of guessing from arbitrary result text or metadata, eliminating false duration markers on successful tools.
- Append duration markers to finalized model-visible messages so the TUI keeps its single native timer, missing-content tools stay safe, blocked preflight failures are covered, and marker-like tool output is still measured.
- Keep the long threshold flag readable in `pi --help` and declare the documented Pi 0.84.0 host floor in package metadata.
- Keep the integration-test dependency lockfile installable from the public npm registry.

### Changed

- Added real Pi CLI integration coverage over a local HTTP model transport for timing, flags, failures, parallel calls, lifecycle cleanup, and result preservation.

## [0.2.0] - 2026-08-06

### Changed

- Requires Pi 0.84.0 or later and refreshes the development lock against the released Pi 0.84.0 packages.
- Verified the tool timing hooks and lifecycle cleanup against Pi 0.84.0's extension events, emitted types, and runtime implementation.

## [0.1.4] - 2026-07-16

- Refreshed the local Pi development lock and validation baseline to Pi 0.80.9; the unified model runtime/provider changes do not affect tool timing.

## [0.1.3] - 2026-07-14

### Changed

- Refreshed the local Pi development lock and validation baseline to Pi 0.80.7.

## [0.1.2] - 2026-07-11

### Changed

- Measure from Pi's `tool_execution_start` event so timing matches the full current execution lifecycle, including preflight hooks.
- Clear abandoned timing state when the agent fully settles.

## [0.1.1] - 2026-07-03

### Changed

- Always append duration markers for tool results that report a non-zero exit code, even below the normal duration threshold.

## [0.1.0] - 2026-06-24

### Added

- Initial `pi-tool-duration` package.
- Appends `[duration: Xs]` to model-visible Pi tool results when execution meets the configured threshold.
- Supports `--tool-duration-threshold-ms` and `PI_TOOL_DURATION_THRESHOLD_MS` overrides.
