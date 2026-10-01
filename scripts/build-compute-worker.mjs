import { build } from "esbuild";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function buildComputeWorker(root, outDir) {
  const result = await build({
    entryPoints: [path.join(root, "src/compute/worker.js")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", minify: false,
  });
  const source = result.outputFiles[0].text;
  const sha256 = createHash("sha256").update(source).digest("hex");
  await writeFile(path.join(outDir, "compute-worker.js"), `// Fixed module generated at build time.\nexport const source = ${JSON.stringify(source)};\nexport const sha256 = ${JSON.stringify(sha256)};\n`);
  await writeFile(path.join(outDir, "compute-worker.d.mts"), "export declare const source: string;\nexport declare const sha256: string;\n");
  await writeFile(path.join(outDir, "compute-worker.d.ts"), "export declare const source: string;\nexport declare const sha256: string;\n");
  return sha256;
}
