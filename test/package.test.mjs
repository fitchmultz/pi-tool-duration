import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("declares the supported Pi host floor", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.peerDependencies["@earendil-works/pi-coding-agent"], ">=0.84.0");
});
