import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

nodeTest("keeps development tarballs on the public npm registry", async () => {
  const lockfile: unknown = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.ok(isRecord(lockfile));
  assert.ok(isRecord(lockfile.packages));
  for (const entry of Object.values(lockfile.packages)) {
    if (isRecord(entry) && typeof entry.resolved === "string") {
      assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
    }
  }
});

nodeTest("uses the host-provided Pi peer without bundling a private runtime", async () => {
  const packageJson: unknown = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.ok(isRecord(packageJson));
  assert.ok(isRecord(packageJson.peerDependencies));
  assert.equal(packageJson.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.ok(isRecord(packageJson.peerDependenciesMeta));
  assert.ok(isRecord(packageJson.peerDependenciesMeta["@earendil-works/pi-coding-agent"]));
  assert.equal(packageJson.peerDependenciesMeta["@earendil-works/pi-coding-agent"].optional, true);
  if (isRecord(packageJson.dependencies)) {
    assert.equal(packageJson.dependencies["@earendil-works/pi-coding-agent"], undefined);
  }
});

nodeTest("loads the installed npm package through Pi", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tool-duration-package-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true }));
    const source = fileURLToPath(new URL("..", import.meta.url));
    const result: unknown = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", root], {
        cwd: source,
        encoding: "utf8",
      }),
    );
    let packed: unknown;
    if (Array.isArray(result)) {
      packed = result[0];
    } else {
      assert.ok(isRecord(result), "npm pack must report an object");
      packed = Object.values(result)[0];
    }
    assert.ok(isRecord(packed));
    assert.ok(typeof packed.filename === "string", "npm pack must report a filename");
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        join(root, packed.filename),
      ],
      { cwd: root, encoding: "utf8" },
    );

    const hostDir = resolve(
      dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
      "..",
    );
    const host: unknown = JSON.parse(await readFile(join(hostDir, "package.json"), "utf8"));
    assert.ok(isRecord(host));
    assert.ok(isRecord(host.bin));
    assert.ok(typeof host.bin.pi === "string", "host package must declare a pi binary");
    const help = execFileSync(
      process.execPath,
      [
        join(hostDir, host.bin.pi),
        "--no-extensions",
        "-e",
        join(root, "node_modules", "pi-tool-duration"),
        "--help",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          HOME: root,
          PI_CODING_AGENT_DIR: join(root, "agent"),
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
        },
      },
    );
    assert.match(help, /--tool-duration-threshold-ms/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
