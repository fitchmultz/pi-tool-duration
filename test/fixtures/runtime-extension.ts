import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  const port = Number(process.env.PI_TOOL_DURATION_TEST_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("PI_TOOL_DURATION_TEST_PORT is required");

  pi.registerProvider("duration-test", {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "local-test-key",
    api: "openai-completions",
    models: [
      {
        id: "scripted",
        name: "Scripted duration test model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_384,
        maxTokens: 1_024,
      },
    ],
  });

  pi.registerTool({
    name: "duration_fixture",
    label: "Duration Fixture",
    description: "Return deterministic results for pi-tool-duration integration tests",
    parameters: Type.Object({ action: Type.String() }),
    async execute(_toolCallId, { action }) {
      if (action === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { content: [{ type: "text" as const, text: "slow-ok" }], details: undefined };
      }
      if (action === "status") {
        return { content: [{ type: "text" as const, text: "status-ok" }], details: { status: 200 } };
      }
      if (action === "exit_text") {
        return { content: [{ type: "text" as const, text: "job exited with code 9" }], details: undefined };
      }
      if (action === "no_content") return {} as never;
      if (action === "error") throw new Error("fixture failed");
      return { content: [{ type: "text" as const, text: "fast-ok" }], details: undefined };
    },
  });
}
