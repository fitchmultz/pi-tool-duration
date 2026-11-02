import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const oxlintBin = join(root, "node_modules/.bin/oxlint");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

type Diagnostic = { code: string; message: string; line: number };

function lintProbes(files: string[]): { status: number | null; diagnostics: Diagnostic[] } {
  const result = spawnSync(oxlintBin, ["--deny-warnings", "--format=json", ...files], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.ok(result.error === undefined, `oxlint failed to start: ${String(result.error)}`);
  const output: unknown = JSON.parse(result.stdout);
  assert.ok(
    isRecord(output) && isJsonArray(output.diagnostics),
    "oxlint must emit a JSON diagnostics array",
  );
  const diagnostics: Diagnostic[] = [];
  for (const raw of output.diagnostics) {
    if (!isRecord(raw) || typeof raw.message !== "string") {
      continue;
    }
    const code = typeof raw.code === "string" ? raw.code : "(none)";
    const label = isJsonArray(raw.labels) ? raw.labels[0] : undefined;
    const line =
      isRecord(label) && isRecord(label.span) && typeof label.span.line === "number"
        ? label.span.line
        : 0;
    diagnostics.push({ code, message: raw.message, line });
  }
  return { status: result.status, diagnostics };
}

function newProbeDir(): string {
  mkdirSync(join(root, "test/zz-probes"), { recursive: true });
  return mkdtempSync(join(root, "test/zz-probes/control-"));
}

// Section 6.4 control 1: the repository's intended unawaited registrations pass.
const PASSING_REGISTRATION_PROBE = `
import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";

nodeTest("top-level registration control", () => {
  assert.ok(true);
});
for (const kind of ["a", "b"]) {
  nodeTest(\`loop registration control \${kind}\`, () => {
    assert.ok(kind.length > 0);
  });
}
`;

// Section 6.4 controls 2-6: every unintended floating Promise still fails.
const CONTEXT_SUBTEST_PROBE = `
import { test as nodeTest } from "node:test";

nodeTest("outer registration", (t) => {
  t.test("inner subtest", () => "value");
});
`;

const SAME_NAMED_LOCAL_PROBE = `
const nodeTest = () => Promise.resolve("local");

nodeTest();
`;

const FOREIGN_HELPER_MODULE = `
export const nodeTest = () => Promise.resolve("foreign");
`;

const FOREIGN_IMPORT_PROBE = `
import { nodeTest } from "./helper.ts";

nodeTest();
`;

const IN_BODY_FLOATING_PROBE = `
import { test as nodeTest } from "node:test";

const backgroundWork = () => Promise.resolve("work");

nodeTest("in-body floating control", () => {
  backgroundWork();
});
`;

const UNRELATED_CALL_PROBE = `
const unrelatedWork = () => Promise.resolve("unrelated");

unrelatedWork();
`;

// The directive text is assembled from a keyword constant so this file never
// contains a line-start directive comment that the inventory control would reject.
const directiveKeyword = "oxlint-disable-next-line";
const unusedDirectiveComment = `// ${directiveKeyword} eqeqeq -- QX-TEST: intentionally unused directive`;
const UNUSED_DIRECTIVE_PROBE = `${unusedDirectiveComment}\nexport const probeValue = 1;\n`;

const FAILING_CONTROLS: readonly (readonly [
  name: string,
  probeFiles: readonly (readonly [filename: string, content: string])[],
])[] = [
  ["context subtest", [["control.test.ts", CONTEXT_SUBTEST_PROBE]]],
  ["same-named local function", [["control.test.ts", SAME_NAMED_LOCAL_PROBE]]],
  [
    "function imported from another module",
    [
      ["control.test.ts", FOREIGN_IMPORT_PROBE],
      ["helper.ts", FOREIGN_HELPER_MODULE],
    ],
  ],
  ["floating promise inside a test body", [["control.test.ts", IN_BODY_FLOATING_PROBE]]],
  ["unrelated promise-returning call", [["control.test.ts", UNRELATED_CALL_PROBE]]],
];

nodeTest("no-floating-promises allowance: intended nodeTest registrations pass", () => {
  const dir = newProbeDir();
  try {
    const probe = join(dir, "control.test.ts");
    writeFileSync(probe, PASSING_REGISTRATION_PROBE);
    const { status, diagnostics } = lintProbes([probe]);
    assert.equal(status, 0, `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
    assert.deepEqual(diagnostics, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, probeFiles] of FAILING_CONTROLS) {
  nodeTest(`no-floating-promises control: unawaited ${name} still fails`, () => {
    const dir = newProbeDir();
    try {
      const probe = join(dir, "control.test.ts");
      for (const [filename, content] of probeFiles) {
        writeFileSync(join(dir, filename), content);
      }
      const { status, diagnostics } = lintProbes([probe]);
      assert.notEqual(status, 0, `expected lint failure: ${JSON.stringify(diagnostics)}`);
      assert.ok(
        diagnostics.some((diagnostic) => diagnostic.code === "typescript(no-floating-promises)"),
        `expected a no-floating-promises diagnostic: ${JSON.stringify(diagnostics)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

nodeTest("unused disable directives are rejected", () => {
  const dir = newProbeDir();
  try {
    const probe = join(dir, "control.test.ts");
    writeFileSync(probe, UNUSED_DIRECTIVE_PROBE);
    const { status, diagnostics } = lintProbes([probe]);
    assert.notEqual(status, 0, `expected lint failure: ${JSON.stringify(diagnostics)}`);
    assert.ok(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Unused oxlint-disable directive"),
      ),
      `expected an unused-directive diagnostic: ${JSON.stringify(diagnostics)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function relocatedDirectiveCopy(sourcePath: string, anchor: string): string {
  const lines = readFileSync(sourcePath, "utf8").split("\n");
  const directiveIndex = lines.findIndex(
    (line) => line.trimStart().startsWith("//") && line.includes("oxlint-disable-next-line"),
  );
  assert.ok(directiveIndex >= 0, `expected a site directive in ${sourcePath}`);
  const removed = lines.splice(directiveIndex, 1);
  const directiveLine = removed.at(0);
  assert.ok(directiveLine !== undefined);
  if (anchor === "^") {
    lines.unshift(directiveLine);
  } else {
    const anchorIndex = lines.findIndex((line) => line.includes(anchor));
    assert.ok(anchorIndex >= 0, `expected anchor ${anchor} in ${sourcePath}`);
    lines.splice(anchorIndex, 0, directiveLine);
  }
  return lines.join("\n");
}

nodeTest("QX-002 directive only suppresses its authorized operation", () => {
  const dir = newProbeDir();
  try {
    const variant = join(dir, "tool-duration-variant.ts");
    writeFileSync(
      variant,
      relocatedDirectiveCopy(
        join(root, "extensions/tool-duration/index.ts"),
        'pi.on("tool_execution_start"',
      ),
    );
    const { status, diagnostics } = lintProbes([variant]);
    assert.notEqual(status, 0, `expected lint failure: ${JSON.stringify(diagnostics)}`);
    assert.ok(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "eslint(no-param-reassign)" &&
          diagnostic.message.includes("preparation"),
      ),
      `expected the preparation assignment to re-expose: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Unused oxlint-disable directive"),
      ),
      `expected the relocated directive to be unused: ${JSON.stringify(diagnostics)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

nodeTest("QX-003 directive only suppresses its authorized operation", () => {
  const dir = newProbeDir();
  try {
    const variant = join(dir, "runtime-extension-variant.test.ts");
    writeFileSync(
      variant,
      relocatedDirectiveCopy(join(root, "test/fixtures/runtime-extension.ts"), "^"),
    );
    const { status, diagnostics } = lintProbes([variant]);
    assert.notEqual(status, 0, `expected lint failure: ${JSON.stringify(diagnostics)}`);
    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.code === "typescript(no-unsafe-type-assertion)"),
      `expected the unsafe assertion to re-expose: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      diagnostics.some(
        (diagnostic) => diagnostic.code === "typescript(consistent-type-assertions)",
      ),
      `expected the assertion style rule to re-expose: ${JSON.stringify(diagnostics)}`,
    );
    assert.ok(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Unused oxlint-disable directive"),
      ),
      `expected the relocated directive to be unused: ${JSON.stringify(diagnostics)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const authorizedDirectiveForm =
  /^\s*\/\/\s*oxlint-disable-next-line\s+([a-z0-9/-]+(?:,\s*[a-z0-9/-]+)*)\s+--\s+(QX-\d+):\s+\S.*$/;
const anyCommentDirectiveForm = /^\s*\/\/\s*(oxlint-disable|eslint-disable)/;

function maintainedTypeScriptSources(): string[] {
  const listing = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts"],
    { cwd: root, encoding: "utf8" },
  );
  return listing
    .split("\n")
    .filter(
      (file) =>
        file !== "" &&
        (file.startsWith("extensions/") ||
          file.startsWith("test/") ||
          file.startsWith("scripts/")) &&
        !file.startsWith("test/zz-probes/"),
    );
}

nodeTest("site directives match the authorized inventory", () => {
  const sources = maintainedTypeScriptSources();
  assert.ok(sources.length >= 6, `unexpected maintained source list: ${sources.join(", ")}`);
  const inventory: string[] = [];
  const rejected: string[] = [];
  for (const file of sources) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!anyCommentDirectiveForm.test(line)) {
        continue;
      }
      const match = authorizedDirectiveForm.exec(line);
      if (match === null) {
        rejected.push(`${file}:${index + 1}: ${line.trim()}`);
        continue;
      }
      const rules = match[1]?.replace(/,\s*/g, ",");
      const identifier = match[2];
      assert.ok(rules !== undefined && identifier !== undefined);
      inventory.push(`${file} | ${rules} | ${identifier}`);
    }
  }
  assert.deepEqual(
    rejected,
    [],
    "only authorized next-line directives with recorded identifiers are allowed",
  );
  const expected = [
    "extensions/tool-duration/index.ts | no-param-reassign | QX-002",
    "extensions/tool-duration/index.ts | no-param-reassign | QX-002",
    "test/fixtures/runtime-extension.ts | typescript/no-unsafe-type-assertion,typescript/consistent-type-assertions | QX-003",
  ];
  assert.deepEqual([...inventory].sort(), [...expected].sort());
});

nodeTest("no-floating-promises safe-call allowance matches the recorded QX-001 boundary", () => {
  const parsed: unknown = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"));
  assert.ok(isRecord(parsed));
  assert.ok(isRecord(parsed.options));
  assert.equal(parsed.options.reportUnusedDisableDirectives, "error");
  assert.equal(parsed.options.denyWarnings, true);
  assert.ok(isRecord(parsed.rules));
  const rule = parsed.rules["typescript/no-floating-promises"];
  assert.ok(isJsonArray(rule));
  const options = rule.at(1);
  assert.ok(isRecord(options));
  assert.ok(isJsonArray(options.allowForKnownSafeCalls));
  assert.deepEqual(options.allowForKnownSafeCalls, [
    { from: "package", package: "node:test", name: ["nodeTest"] },
  ]);
});
