import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("keeps development tarballs on the public npm registry", async () => {
  const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const { resolved } of Object.values(lockfile.packages)) {
    if (resolved) assert.match(resolved, /^https:\/\/registry\.npmjs\.org\//);
  }
});

test("uses the host-provided Pi peer without bundling a private runtime", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(packageJson.peerDependenciesMeta["@earendil-works/pi-coding-agent"].optional, true);
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
});

test("loads the installed npm package through Pi", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tool-duration-package-"));
  try {
    const source = fileURLToPath(new URL("..", import.meta.url));
    const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", root], {
      cwd: source, encoding: "utf8",
    }));
    const { filename } = Array.isArray(result) ? result[0] : Object.values(result)[0];
    execFileSync("npm", ["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", join(root, filename)], {
      cwd: root, encoding: "utf8",
    });

    const hostDir = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
    const host = JSON.parse(await readFile(join(hostDir, "package.json"), "utf8"));
    const help = execFileSync(process.execPath, [
      join(hostDir, host.bin.pi), "--no-extensions", "-e", join(root, "node_modules", "pi-tool-duration"), "--help",
    ], {
      cwd: root, encoding: "utf8", timeout: 20_000,
      env: {
        ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, "agent"),
        PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
      },
    });
    assert.match(help, /--tool-duration-threshold-ms/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
