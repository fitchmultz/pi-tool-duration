import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Opt in with a checkpoint-capable native host; never substitute a mock guard.
test("native settled checkpoints preserve history and tool selection across reload/restore", {
  skip: !process.env.PI_HOST_INDEX && "Set PI_HOST_INDEX to a checkpoint-capable host's dist/index.js",
}, () => {
  const home = mkdtempSync(join(tmpdir(), "pi-tool-duration-checkpoint-"));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { pathToFileURL } from "node:url";
      import { join } from "node:path";
      globalThis.fetch = async () => { throw new Error("No network in checkpoint test"); };
      const pi = await import(pathToFileURL(process.env.PI_HOST_INDEX));
      const cwd = process.env.HOME;
      const agentDir = join(cwd, "agent");
      const create = async checkpoint => {
        const settingsManager = pi.SettingsManager.inMemory();
        const modelRuntime = await pi.ModelRuntime.create({
          authPath: join(agentDir, "empty-auth.json"), modelsPath: null,
          refreshOnCreate: false, allowModelNetwork: false,
        });
        const resourceLoader = new pi.DefaultResourceLoader({
          cwd, agentDir, settingsManager,
          noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
          additionalExtensionPaths: [process.env.TEST_EXTENSION],
        });
        await resourceLoader.reload({ resolveProjectTrust: async () => false });
        assert.deepEqual(resourceLoader.getExtensions().errors, []);
        const { session } = await pi.createAgentSession({
          cwd, agentDir, settingsManager, modelRuntime, resourceLoader, checkpoint,
          sessionManager: pi.SessionManager.create(cwd, join(cwd, "sessions")),
        });
        await session.bindExtensions({ onError: error => { throw new Error(JSON.stringify(error)); } });
        return session;
      };
      let session = await create();
      const capture = async () => {
        const hold = await session.acquireCheckpoint({ signal: AbortSignal.timeout(3000), quiesce: () => () => {} });
        try {
          assert.equal(hold.sleepReady, true, JSON.stringify(hold.sleepBlockers));
          assert.deepEqual(hold.sleepBlockers, []);
          assert.equal(hold.checkpoint.boundary, "settled");
          return hold.checkpoint;
        } finally { hold.release(); }
      };
      try {
        session.sessionManager.appendMessage({ role: "user", content: "synthetic history", timestamp: 1 });
        const saved = await capture();
        await session.reload();
        const reloaded = await capture();
        assert.deepEqual(reloaded.entries, saved.entries);
        assert.deepEqual(reloaded.selection.activeTools, saved.selection.activeTools);
        session.dispose();
        session = await create(reloaded);
        const restored = await capture();
        assert.deepEqual(restored.entries, reloaded.entries);
        assert.deepEqual(restored.selection, reloaded.selection);
      } finally { session.dispose(); }
    `], {
      cwd: home, encoding: "utf8", timeout: 20_000,
      env: {
        HOME: home, PATH: process.env.PATH ?? "", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
        PI_CODING_AGENT_DIR: join(home, "agent"), PI_HOST_INDEX: process.env.PI_HOST_INDEX,
        TEST_EXTENSION: fileURLToPath(new URL("../extensions/tool-duration/index.ts", import.meta.url)),
      },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
