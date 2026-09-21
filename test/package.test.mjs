import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
