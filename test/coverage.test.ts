import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";

// Canonicalized once: the test module URL and child-process cwd must agree even
// through symlinked checkouts (for example /tmp -> /private/tmp on macOS).
// Canonicalized once: the test module URL and child-process output must agree even
// through symlinked checkouts (for example /tmp -> /private/tmp on macOS).
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

function canonicalExistingPath(absolutePath: string): string | undefined {
  // Entries can disappear between the child-process listing and this check
  // while the parallel enforcement suite rotates its probe files; only stable
  // paths matter for maintained-source membership.
  try {
    return realpathSync(absolutePath);
  } catch {
    return;
  }
}

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

function compilerProjectFiles(): Set<string> {
  const listing = execFileSync(join(root, "node_modules/.bin/tsc"), ["--listFilesOnly"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  const project = new Set<string>();
  for (const line of listing.split("\n")) {
    if (line === "") {
      continue;
    }
    const canonical = canonicalExistingPath(resolve(root, line));
    if (canonical !== undefined) {
      project.add(canonical);
    }
  }
  return project;
}

nodeTest("every maintained TypeScript source belongs to the compiler project", () => {
  const sources = maintainedTypeScriptSources();
  assert.ok(sources.length >= 6, `unexpected maintained source list: ${sources.join(", ")}`);
  const project = compilerProjectFiles();
  const missing = sources.filter((file) => {
    const canonical = canonicalExistingPath(resolve(root, file));
    return canonical === undefined || !project.has(canonical);
  });
  assert.deepEqual(
    missing,
    [],
    "maintained sources must be inside the tsconfig project (Section 4.1 membership)",
  );
});
