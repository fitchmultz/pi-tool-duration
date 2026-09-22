import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  const port = Number(process.env.PI_TOOL_DURATION_TEST_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("PI_TOOL_DURATION_TEST_PORT is required");

  pi.registerProvider("duration-test", {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "local-test-key",
    api: "openai-responses",
    models: [
      {
        id: "scripted",
        name: "Scripted duration test model",
        reasoning: true,
        input: ["text", "image"],
        compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_384,
        maxTokens: 1_024,
      },
    ],
  });

  pi.registerCommand("duration-test-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });

  pi.registerCommand("duration-test-compact", {
    handler: async (_args, ctx) => {
      await new Promise<void>((resolve, reject) => {
        ctx.compact({ onComplete: () => resolve(), onError: reject });
      });
      pi.sendMessage({
        customType: "duration-test-recorded",
        content: JSON.stringify(ctx.sessionManager.getEntries()),
        display: false,
      });
    },
  });

  pi.on("tool_call", (event) => {
    if (event.toolName === "duration_fixture" && event.input.action === "blocked") {
      return { block: true, reason: "fixture blocked" };
    }
  });

  if (process.env.PI_TOOL_DURATION_TEST_REPLACE_TIMESTAMP === "true") {
    pi.on("message_end", ({ message }) => {
      if (message.role === "toolResult") return { message: { ...message, timestamp: 1 } };
    });
  }

  pi.on("session_start", () => pi.setActiveTools(["duration_fixture"]));

  pi.registerTool({
    name: "duration_extra",
    label: "Extra Fixture",
    description: "A tool activated after the first timed result",
    promptSnippet: "Extra fixture available after loading",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text" as const, text: "extra-ok" }], details: undefined };
    },
  });

  pi.registerTool({
    name: "duration_fixture",
    label: "Duration Fixture",
    description: "Return deterministic results for pi-tool-duration integration tests",
    promptSnippet: "Run duration fixtures",
    parameters: Type.Object({ action: Type.String() }),
    async execute(_toolCallId, { action }) {
      if (action === "load") {
        pi.setActiveTools([...pi.getActiveTools(), "duration_extra"]);
        return {
          content: [
            { type: "text" as const, text: "loaded-extra" },
            { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" },
          ],
          details: { status: 201 },
        };
      }
      if (action === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 650));
        return { content: [{ type: "text" as const, text: "slow-ok" }], details: { status: 201 } };
      }
      if (action === "long") {
        return { content: [{ type: "text" as const, text: "long-output ".repeat(400) }], details: { status: 200 } };
      }
      if (action === "status") {
        return { content: [{ type: "text" as const, text: "status-ok" }], details: { status: 200 } };
      }
      if (action === "exit_text") {
        return { content: [{ type: "text" as const, text: "job exited with code 9" }], details: undefined };
      }
      if (action === "marker") {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return { content: [{ type: "text" as const, text: "[host tool-call elapsed: 9.9s]" }], details: undefined };
      }
      // Exercise Pi's normalization of JavaScript tools that omit content.
      if (action === "no_content") return {} as never;
      if (action === "error") throw new Error("fixture failed");
      return { content: [{ type: "text" as const, text: "fast-ok" }], details: undefined };
    },
  });
}
