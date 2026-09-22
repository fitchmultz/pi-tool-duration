import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const required = process.env.PI_COMPAT_HOST === "fork" || process.env.PI_REQUIRE_CHECKPOINT === "1";
const hostIndex = process.env.PI_HOST_INDEX ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));

test("native timed results survive reload and cold restoration", (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-tool-duration-checkpoint-"));
  const program = `
    import assert from "node:assert/strict";
    import { findPackageJSON } from "node:module";
    import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    import { join } from "node:path";
    globalThis.fetch = async () => { throw new Error("No network in restoration test"); };
    const host = pathToFileURL(process.env.PI_HOST_INDEX);
    const pi = await import(host);
    const hasCheckpoints = typeof pi.AgentSession.prototype.acquireCheckpoint === "function";
    assert.ok(hasCheckpoints || process.env.TEST_REQUIRE_CHECKPOINT !== "true", "This host requires checkpoint support");
    if (process.env.TEST_RESTORE === "checkpoint" && !hasCheckpoints) process.exit(77);
    const aiPackage = pathToFileURL(findPackageJSON("@earendil-works/pi-ai", host));
    const { createAssistantMessageEventStream } = await import(new URL("./dist/index.js", aiPackage));
    const cwd = process.env.HOME;
    const agentDir = join(cwd, "agent");
    const checkpointPath = join(cwd, "checkpoint.json");
    const statePath = join(cwd, "expected-state.json");
    const errors = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    let clock = 1000;
    Object.defineProperty(performance, "now", { value: () => clock });
    const tool = {
      name: "checkpoint_fixture", label: "Checkpoint Fixture", description: "A local timed fixture",
      parameters: { type: "object", properties: {} },
      async execute() {
        clock += 1500;
        return { content: [{ type: "text", text: "timed output" }], details: { status: 201 } };
      },
    };
    const create = async (checkpoint, sessionFile) => {
      const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
      const modelRuntime = await pi.ModelRuntime.create({
        authPath: join(agentDir, "empty-auth.json"), modelsPath: null,
        refreshOnCreate: false, allowModelNetwork: false,
      });
      const model = modelRuntime.getModels().find(model => model.provider === "anthropic");
      assert.ok(model, "offline catalog model");
      // Bypass only auth admission; every prompt uses the local native EventStream below.
      modelRuntime.hasConfiguredAuth = () => true;
      const resourceLoader = new pi.DefaultResourceLoader({
        cwd, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        additionalExtensionPaths: [process.env.TEST_EXTENSION],
      });
      await resourceLoader.reload({ resolveProjectTrust: async () => false });
      assert.deepEqual(resourceLoader.getExtensions().errors, []);
      const { session } = await pi.createAgentSession({
        cwd, agentDir, settingsManager, modelRuntime, model, resourceLoader, checkpoint,
        customTools: [tool], noTools: "builtin",
        sessionManager: sessionFile ? pi.SessionManager.open(sessionFile) : pi.SessionManager.create(cwd, join(cwd, "sessions")),
      });
      await session.bindExtensions({ onError: error => errors.push(error) });
      return session;
    };
    const capture = async session => {
      const hold = await session.acquireCheckpoint({ signal: AbortSignal.timeout(3000), quiesce: () => () => {} });
      try {
        assert.equal(hold.sleepReady, true, JSON.stringify(hold.sleepBlockers));
        assert.deepEqual(hold.sleepBlockers, []);
        assert.equal(hold.checkpoint.boundary, "settled");
        return hold.checkpoint;
      } finally { hold.release(); }
    };
    const state = session => ({
      entries: session.sessionManager.getEntries(), activeTools: session.getActiveToolNames(),
    });
    const assertTimed = messages => {
      const results = messages.filter(message => message.role === "toolResult");
      assert.equal(results.length, 1);
      assert.deepEqual(results[0].content, [
        { type: "text", text: "timed output" },
        { type: "text", text: "[host tool-call elapsed: 1.5s]" },
      ]);
      assert.deepEqual(results[0].details, { status: 201 });
    };
    const prompt = async (session, runTool = false) => {
      const requests = [];
      session.agent.streamFunction = (model, context) => {
        requests.push(structuredClone(context));
        const toolCall = runTool && requests.length === 1;
        const message = {
          role: "assistant", api: model.api, model: model.id, provider: model.provider, usage, timestamp: Date.now(),
          content: toolCall ? [{ type: "toolCall", id: "timed-call", name: tool.name, arguments: {} }] : [{ type: "text", text: "done" }],
          stopReason: toolCall ? "toolUse" : "stop",
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
        return stream;
      };
      await session.prompt("Run the local checkpoint fixture.");
      await session.waitForIdle();
      assert.equal(requests.length, runTool ? 2 : 1);
      assertTimed(requests.at(-1).messages);
      assert.deepEqual(errors, []);
    };
    const saved = process.env.TEST_RESTORE ? JSON.parse(readFileSync(statePath, "utf8")) : undefined;
    const checkpoint = process.env.TEST_RESTORE === "checkpoint" ? pi.readSessionCheckpoint(checkpointPath) : undefined;
    const session = await create(checkpoint, process.env.TEST_RESTORE === "disk" ? saved.file : undefined);
    try {
      if (saved) {
        assert.deepEqual(state(session), saved.state);
        if (checkpoint) assert.deepEqual((await capture(session)).selection, checkpoint.selection);
        await prompt(session);
      } else {
        await prompt(session, true);
        const entries = session.sessionManager.getEntries();
        const result = entries.find(entry => entry.type === "message" && entry.message.role === "toolResult");
        const timing = entries.find(entry => entry.type === "custom" && entry.customType === "pi-tool-duration");
        assert.equal(result.parentId, timing.id, "hidden timing precedes the native finalized result");
        assert.deepEqual(Object.keys(timing.data).sort(), ["duration", "timestamp", "toolCallId"]);
        assert.deepEqual(result.message.content, [{ type: "text", text: "timed output" }]);
        assert.deepEqual(result.message.details, { status: 201 });
        assert.equal(timing.data.duration, "[host tool-call elapsed: 1.5s]");
        const beforeReload = state(session);
        await session.reload();
        assert.deepEqual(state(session), beforeReload);
        await prompt(session);
        // The disk-resume prompt must not change the journal used by the checkpoint restore.
        const diskSession = join(cwd, "disk-session.jsonl");
        copyFileSync(session.sessionFile, diskSession);
        writeFileSync(statePath, JSON.stringify({ file: diskSession, state: state(session) }));
        if (hasCheckpoints) pi.writeSessionCheckpoint(checkpointPath, await capture(session));
      }
    } finally { session.dispose(); }
  `;
  try {
    // Separate processes prevent restoration from reusing in-memory timing maps.
    for (const restore of ["", "disk", "checkpoint"]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
        cwd: home, encoding: "utf8", timeout: 20_000,
        env: {
          HOME: home, PATH: process.env.PATH ?? "", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
          PI_CODING_AGENT_DIR: join(home, "agent"), PI_HOST_INDEX: hostIndex,
          TEST_EXTENSION: resolve(process.env.PI_TOOL_DURATION_TEST_EXTENSION ?? fileURLToPath(new URL("../extensions/tool-duration/index.ts", import.meta.url))),
          TEST_RESTORE: restore, TEST_REQUIRE_CHECKPOINT: String(required),
        },
      });
      if (result.status === 77) {
        assert.equal(restore, "checkpoint");
        assert.ok(!required, "This job requires a checkpoint-capable native host");
        t.diagnostic("Native checkpoint unavailable; timed cold disk restoration passed.");
        continue;
      }
      assert.equal(result.status, 0, (restore || "capture") + ": " + (result.stderr || String(result.error)));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
