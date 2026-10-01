import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { runVaultCheck } from "./vault-check.mjs";
test("PoW declaration requests review without opening Worker or network permissions", () => {
  const slug = `pow-selftest-${process.pid}`;
  const dir = path.join(process.cwd(), "src/vaults", slug);
  const example = path.join(process.cwd(), "src/vaults/example");
  const oldSkip = process.env.VAULT_CHECK_SKIP_REGISTRATION;
  process.env.VAULT_CHECK_SKIP_REGISTRATION = "1";
  fs.mkdirSync(dir);
  try {
    for (const name of ["Component.tsx", "manifest.json", "i18n.json", "VaultABI.ts"]) fs.copyFileSync(path.join(example, name), path.join(dir, name));
    const file = path.join(dir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.capabilities = ["flapcred-keccak-cpu-v1"];
    fs.writeFileSync(file, JSON.stringify(manifest));
    const result = runVaultCheck(slug, { silent: true });
    assert.ok(result.issues.some(i => i.ruleId === "manual-review/pow-compute" && i.severity === "warning"));
    assert.ok(!result.issues.some(i => i.ruleId === "manifest-schema/unknown-capability"));
    fs.appendFileSync(path.join(dir, "Component.tsx"), '\nconst forbiddenWorker = new Worker("/miner.js");\n');
    const blocked = runVaultCheck(slug, { silent: true });
    assert.ok(blocked.issues.some(i => i.ruleId === "forbidden-api/browser-worker" && i.severity === "blocking"));
    fs.appendFileSync(path.join(dir, "Component.tsx"), '\nimport { wrap } from "comlink";\n');
    const blockedImport = runVaultCheck(slug, { silent: true });
    assert.ok(blockedImport.issues.some(i => i.ruleId === "imports-and-dependencies/unreviewed-import" && i.severity === "blocking" && i.message.includes("comlink")));
  } finally {
    fs.rmSync(dir, { recursive: true });
    if (oldSkip === undefined) delete process.env.VAULT_CHECK_SKIP_REGISTRATION;
    else process.env.VAULT_CHECK_SKIP_REGISTRATION = oldSkip;
  }
});
