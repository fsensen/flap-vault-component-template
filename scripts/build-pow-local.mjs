// Local feasibility build only. Does not bypass or change release/canary provenance checks.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComputeWorker } from "./build-compute-worker.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist/vault-runtime-pow");
execFileSync("yarn", ["tsup", "--config", "tsup.runtime.config.ts", "--out-dir", out], { cwd: root, stdio: "inherit" });
const workerSha256 = await buildComputeWorker(root, out);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const entry of ["sdk.js", "ui.js"]) {
  const file = path.join(out, entry);
  await writeFile(file, '"use client";\n' + await readFile(file, "utf8"));
}
const digest = createHash("sha256");
for (const name of (await readdir(out)).filter(name => name.endsWith(".js")).sort()) digest.update(name).update(await readFile(path.join(out, name)));
const contentSha256 = digest.digest("hex");
const manifest = {
  name: "@flapsdk/vault-runtime", version: `${pkg.version}-pow.local.${contentSha256.slice(0, 12)}`,
  private: true, type: "module", sideEffects: false,
  exports: Object.fromEntries(["sdk", "ui", "host", "server", "compute-worker"].map(name => [`./${name}`, { types: `./${name}.d.mts`, import: `./${name}.js` }])),
  flapLocal: { sourceBaseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), contentSha256, workerSha256, uncommittedSourceAllowed: true, publishable: false },
};
manifest.exports["./package.json"] = "./package.json";
manifest.exports["./runtime-contract"] = "./runtime-contract.json";
await writeFile(path.join(out, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(out, "runtime-contract.json"), JSON.stringify({ runtimeContractVersion: 1, packageName: manifest.name, packageVersion: manifest.version, stableAuthoringAliases: ["@/src/sdk", "@/src/ui"], runtimeExternals: ["react", "react-dom", "react/jsx-runtime", "wagmi", "viem"], componentFacingEntrypoints: ["./sdk", "./ui"], hostFacingEntrypoints: ["./host", "./server", "./compute-worker"], localOnly: true }, null, 2) + "\n");
console.log(JSON.stringify({ packageDir: out, version: manifest.version, workerSha256, publishable: false }));
