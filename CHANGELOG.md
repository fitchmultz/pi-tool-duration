# Changelog

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
