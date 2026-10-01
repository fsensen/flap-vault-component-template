import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { MessageChannel } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { wrap, releaseProxy } from "comlink";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "../dist/vault-runtime-pow/ui.js";
import { source, sha256 } from "../dist/vault-runtime-pow/compute-worker.js";
import { encodeAbiParameters, keccak256 } from "viem";

const job = { domain: "0xb89c2844bbff69cd768e656db4baa1f754523647654be61cb5d903a5d4dc0022", chainId: 97, contract: "0x" + "33".repeat(20), miner: "0x" + "44".repeat(20), anchorHash: "0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871", nonceHigh: "0x" + "55".repeat(24) + "00".repeat(8), target: "0x0000" + "ff".repeat(30) };
function workerFor(t) {
  const { port1, port2 } = new MessageChannel();
  const context = vm.createContext({ self: port2, performance, setTimeout, crypto: { getRandomValues: array => array.fill(7) } });
  new vm.Script(source).runInContext(context);
  const remote = wrap(port1);
  t.after(() => { remote[releaseProxy](); port1.close(); port2.close(); });
  return remote;
}

test("packaged UI renders without a global React variable", () => {
  assert.equal(globalThis.React, undefined);
  assert.match(renderToStaticMarkup(React.createElement(Card, null, "runtime-test")), /runtime-test/);
});
test("Comlink is bundled internally, with no consumer dependency or public type leak", async () => {
  for (const entry of ["host.js", "host.d.mts", "sdk.d.mts"]) {
    const content = await readFile(new URL(`../dist/vault-runtime-pow/${entry}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /(?:from|import)\s*[('" ]+comlink/);
  }
});
test("emitted Comlink worker bytes match hash and produce bounded independently valid work", { timeout: 10000 }, async t => {
  assert.equal(createHash("sha256").update(source).digest("hex"), sha256);
  const remote = workerFor(t);
  await remote.initialize({ job, durationMs: 5000, maxHashes: 50_000 });
  const batches = [];
  do { batches.push(await remote.nextBatch()); } while (batches.at(-1).type !== "done");
  assert.equal(batches.at(-1).hashes, 50_000);
  assert.ok(batches.every(batch => batch.nonces.length <= 8));
  const nonces = batches.flatMap(batch => batch.nonces);
  assert.ok(nonces.length > 0);
  for (const nonce of nonces) {
    const digest = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }], [job.domain, 97n, job.contract, job.anchorHash, job.miner, BigInt(nonce)]));
    assert.ok(BigInt(digest) < BigInt(job.target));
  }
});
test("packaged worker rejects bad budgets, uninitialized calls and repeated initialization", { timeout: 5000 }, async t => {
  const remote = workerFor(t);
  await assert.rejects(remote.nextBatch(), /not-initialized/);
  await assert.rejects(remote.initialize({ job, durationMs: 30001, maxHashes: 1000 }), /invalid-budget/);
  await remote.initialize({ job, durationMs: 1000, maxHashes: 1000 });
  await assert.rejects(remote.initialize({ job, durationMs: 1000, maxHashes: 1000 }), /already-initialized/);
});
