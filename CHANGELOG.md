# Changelog

## [Unreleased]

## 0.6.10 - 2026-11-10

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Compare session state without host records in the restoration test (#55) ([fdb671a](https://github.com/fitchmultz/pi-tool-duration/commit/fdb671a03c1e8010efba11cf03c5b337dcd37376))

### What's Changed

- Compare session state without host records in the restoration test by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/55

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.9...v0.6.10

## 0.6.9 - 2026-11-03

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Skip no-op releases and restate malformed remediation dispositions (#53) ([bf45c06](https://github.com/fitchmultz/pi-tool-duration/commit/bf45c06add455d46f5a305b1267638bf85756e0d))

### What's Changed

- Skip no-op releases and restate malformed remediation dispositions by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/53

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.8...v0.6.9

## 0.6.8 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Recheck unreported Cursor reviews in automatic releases (#50) ([85c8cc8](https://github.com/fitchmultz/pi-tool-duration/commit/85c8cc8503c37852f7758098cea69ee67fddcd1d))

### What's Changed

- Recheck unreported Cursor reviews in automatic releases by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/50

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.7...v0.6.8

## 0.6.7 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Raise the Pi floor to 1.5.0 (#48) ([e0f20b6](https://github.com/fitchmultz/pi-tool-duration/commit/e0f20b6d4c1709598b548fbe76c72ddb5dea2a06))

### What's Changed

- Raise the Pi floor to 1.5.0 by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/48

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.6...v0.6.7

## 0.6.6 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Adopt the strict Oxlint/Oxfmt engineering standard (v5.1.2) (#46) ([af7fa6d](https://github.com/fitchmultz/pi-tool-duration/commit/af7fa6de4f73c13c972f59e9749d775c05ee5e9a))

### What's Changed

- Adopt the strict Oxlint/Oxfmt engineering standard (v5.1.2) by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/46

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.5...v0.6.6

## 0.6.5 - 2026-11-02

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- chore(deps-dev): bump brace-expansion from 5.0.9 to 5.0.12 (#37) ([0710efb](https://github.com/fitchmultz/pi-tool-duration/commit/0710efb611c04032e7fe8ff0ddceac4360f8b28d))

### What's Changed

- chore(deps-dev): bump brace-expansion from 5.0.9 to 5.0.12 by @dependabot[bot] in https://github.com/fitchmultz/pi-tool-duration/pull/37

### New Contributors

- @dependabot[bot] made their first contribution in https://github.com/fitchmultz/pi-tool-duration/pull/37

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.4...v0.6.5

## 0.6.4 - 2026-11-01

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Use direct Flash for automatic release remediation (#42) ([eb6fbf5](https://github.com/fitchmultz/pi-tool-duration/commit/eb6fbf5765d1602512f622f123c8aaa76ec31b33))

### What's Changed

- Use direct Flash for necessary release remediation by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/42

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.3...v0.6.4

## 0.6.3 - 2026-11-01

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Pin reviewed release source binding (#40) ([e34f502](https://github.com/fitchmultz/pi-tool-duration/commit/e34f50225957183c0cc9a2312d68076d4caa7717))

### What's Changed

- Bind automatic releases to the reviewed version by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/40

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.2...v0.6.3

## 0.6.2 - 2026-10-31

<!-- npm-release:unreleased:start -->
<!-- npm-release:unreleased:end -->

- Automate reviewed npm patch releases (#38) ([f000cb5](https://github.com/fitchmultz/pi-tool-duration/commit/f000cb550f8e0cfc8b3ca5deafa2f01ffce2687a))

### What's Changed

- Automate reviewed npm patch releases by @fitchmultz in https://github.com/fitchmultz/pi-tool-duration/pull/38

**Full Changelog**: https://github.com/fitchmultz/pi-tool-duration/compare/v0.6.1...v0.6.2

## [0.6.1] - 2026-10-31

### Documentation

- Rewrite the README around installation, examples, and configuration; add a tool-timing diagram and move technical and maintainer reference material into `docs/`.
- Document the unpinned Git installation fallback.

### Tests

- Check native Responses tool declarations on current official Pi and the maintained fork.

## [0.6.0] - 2026-10-01

### Changed

- Require Pi 1.0.0; qualify against the exact official 1.0.0 cohort and host TypeBox 1.3.27.
- Cache timing and known absence per finalized result occurrence on the selected branch. Cold legacy recovery remains complete; warmed orphan requests no longer rewalk history, and appends process only their suffix.
- Share one lookup for both compaction input arrays, skipping all history work for text-only compaction.
- Keep same-ID/same-finalized-timestamp result occurrences separate, including their ordered request and compaction copies.
- Use only official 1.0 APIs; retire metadata/checkpoint runtime branches dropped from the maintained fork. Preserve legacy checkpoint copies when reading old journals.

## [0.5.0] - 2026-10-01

### Changed

- Leave successful calls under 50 ms unannotated by default; their marker would read `0.0s`. Failed calls are still always annotated. Set `PI_TOOL_DURATION_THRESHOLD_MS=0` to annotate every result again.

### Removed

- Retired fork-native async detach/resume timing and live continuation event integrations. Ordinary tool timing and saved timing markers remain supported.

## [0.4.1] - 2026-09-26

### Fixed

- Include the timing marker in results sent on the maintained fork's live WebSocket steering continuations, using its `live_tool_result` event. Recorded output is unchanged, and the live copy matches later requests.

## [0.4.0] - 2026-09-26

### Fixed

- Annotate every result when concurrent native async completions persist all of their timings before any result. Timings are matched by call ID up to the issuing assistant message.
- Keep measured time for fork native async calls that detach and resume, including across restarts. The reported duration sums the observed active spans and excludes detached time.

### Changed

- Require Node.js 24 or later and develop against Pi 0.87.1, TypeScript 7, and Node 24 types.
- Regenerate the development lockfile from scratch on the public npm registry.

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
