# Development and maintenance

[Back to the README](../README.md)

## Local setup

Requires Node.js 24 or later and Pi 1.0.0 or later. From a checkout:

```bash
npm ci --ignore-scripts
npm run check
```

`check` runs typechecking, unit and native runtime tests, and an installed npm package smoke test. There is no production build or `prepare` step.

Install from Git with:

```bash
pi install git:github.com/fitchmultz/pi-tool-duration
```

Or use the checkout directly:

```bash
pi install .                         # global settings
pi install -l --approve .            # project settings; trust this checkout
pi --no-extensions -e .              # try without installing
```

`--no-extensions` prevents a duplicate flag conflict when another copy is already installed. It also disables other discovered and built-in extensions for that invocation. On supported Pi hosts, `/reload` refreshes extension code; restart after dependency changes.

Try threshold options against the checkout:

```bash
PI_TOOL_DURATION_THRESHOLD_MS=0 pi --no-extensions -e .
PI_TOOL_DURATION_THRESHOLD_MS=1000 pi --no-extensions -e .
pi --no-extensions -e . --tool-duration-threshold-ms 500
```

## Compatibility qualification

Locked development dependencies are reproducible snapshots, not qualification targets. Plain `npm ci` checks only the locked development snapshot, not latest-host qualification. The host-provided Pi peer stays wildcard and optional rather than bundling a runtime. The lockfile resolves every package from the public npm registry.

CI tests the latest stable official release and latest maintained fork `main` on pull requests and weekly. It resolves the version and commit once per workflow run, selects each complete host graph, and retains exact SDK and CLI evidence.

For latest-host qualification, use the scripts from the shared [`fitchmultz/.github`](https://github.com/fitchmultz/.github) automation checkout:

```bash
node /path/to/automation/scripts/qualify.mjs \
  --repo pi-tool-duration --source "$PWD" \
  --host official --target latest \
  --output /tmp/pi-tool-duration-official
```

Then qualify the packed latest maintained fork with `--host fork --target /path/to/fork-package` and a separate output directory.

## Runtime and restoration tests

Runtime tests use the installed host's manifest `bin.pi` entry and a local scripted Responses provider in an isolated HOME. `PI_HOST_CLI`, `PI_COMPAT_EXPECTED_VERSION`, and `PI_COMPAT_EXPECTED_PACKAGE_DIR` can assert the selected graph.

The runtime and restoration tests use the installed host by default; `PI_HOST_INDEX` can select another host's absolute `dist/index.js`. They execute timed tools and verify reload plus separate-process disk restoration on both hosts. The maintained 1.0 fork no longer has native checkpoints; separate-process disk restoration is the portable recovery check. These tests use local scripted model completions without provider network calls or credentials.

## Lookup implementation notes

The lookup reconciles at the next read, after native message finalization and boundary drafts have committed. It does not register an extra `turn_end` handler merely to read IDs: official Pi eagerly builds full-branch boundary previews for those handlers, while the append suffix already provides finalized occurrence IDs and timestamps.

Both 1.0 targets use official O(1) parent lookups; unsupported metadata, revision, and checkpoint APIs from the former fork are not required or carried forward. Legacy checkpoint assistant copies remain readable without being mistaken for original issuing messages. See the [timing reference](reference.md#session-history-and-matching) for matching behavior.

## Automatic npm releases

Follow the [shared release procedure](https://github.com/fitchmultz/.github#automatic-npm-releases): merge a reviewed PR into `main` with an intentional `package.json` version bump and a matching versioned `CHANGELOG.md` section. Once configured and enabled, publication is unattended after the existing current-official/fork compatibility checks and candidate-tarball qualification pass. Complete any applicable package-specific release evidence before merging the bump. Automation never bumps versions, overwrites releases, or republishes an existing version; existing manual publisher instructions remain valid.

Failed or unpublished candidates can retry daily at 12:17 UTC or via manual dispatch of `npm release` on `main`, without another bump. Set repository variable `NPM_RELEASE_ENABLED` to anything other than `true` to stop new release plans; cancel pending runs separately when needed. Workflow validation is not evidence of a completed real OIDC publication.
