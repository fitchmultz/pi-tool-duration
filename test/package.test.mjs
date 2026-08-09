import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps development tarballs on the public npm registry", async () => {
  const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const { resolved } of Object.values(lockfile.packages)) {
    if (resolved) assert.match(resolved, /^https:\/\/registry\.npmjs\.org\//);
  }
});

test("declares the supported Pi host floor", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.peerDependencies["@earendil-works/pi-coding-agent"], ">=0.84.0");
});
