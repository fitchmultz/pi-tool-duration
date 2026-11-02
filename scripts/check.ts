import { spawnSync } from "node:child_process";

// Independent gates: every gate runs so one failure cannot hide the rest.
const gates: readonly (readonly [label: string, npmArgs: readonly string[]])[] = [
  ["lint", ["run", "lint"]],
  ["format", ["run", "format:check"]],
  ["typecheck", ["run", "typecheck"]],
  ["test", ["test"]],
];

const failures: string[] = [];
for (const [label, npmArgs] of gates) {
  console.log(`\n==> ${label} <==`);
  const result = spawnSync("npm", [...npmArgs], { stdio: "inherit" });
  if (result.status !== 0) {
    failures.push(label);
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`failed gates: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("all gates passed");
}
