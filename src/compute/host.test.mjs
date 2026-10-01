import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { expose } from "comlink";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { encodeAbiParameters, keccak256 } from "viem";
import { prepare, search, digestHex, nonceHex } from "./keccak-core.js";

async function bundle(name) {
  const built = await build({ entryPoints: [new URL(name, import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node" });
  return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
}
const { createPowComputeHost, validatePowJob, verifyPowCandidate } = await bundle("./host.ts");
const { createPowWorkerClient } = await bundle("./workerClient.ts");
const profile = "flapcred-keccak-cpu-v1";
const job = {
  domain: "0xb89c2844bbff69cd768e656db4baa1f754523647654be61cb5d903a5d4dc0022",
  chainId: 97, contract: "0x" + "33".repeat(20), miner: "0x" + "44".repeat(20),
  anchorHash: "0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871",
  nonceHigh: "0x" + "55".repeat(24) + "00".repeat(8), target: "0x0000" + "ff".repeat(30),
};
const policy = { enabled: true, capabilities: [profile], scope: job };
const request = { profile, job };
async function until(predicate) {
  const deadline = performance.now() + 1500;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "Comlink response timed out");
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
// Real Comlink serialization over MessagePorts, with controllable compute completion.
class FakeWorker {
  static all = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Set();
    const { port1, port2 } = new MessageChannel();
    this.hostPort = port1;
    this.workerPort = port2;
    this.api = {
      initialize: input => { this.input = input; },
      nextBatch: () => new Promise((resolve, reject) => { this.pending = { resolve, reject }; }),
    };
    expose(this.api, port2);
    port1.start();
    FakeWorker.all.push(this);
  }
  postMessage(message, transfer) { this.hostPort.postMessage(message, transfer); }
  addEventListener(type, listener) { this.listeners.add(listener); this.hostPort.addEventListener(type, listener); }
  removeEventListener(type, listener) { this.listeners.delete(listener); this.hostPort.removeEventListener(type, listener); }
  terminate() { this.terminated = true; this.hostPort.close(); this.workerPort.close(); }
  async respond(data) {
    await until(() => this.pending);
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(data);
    await until(() => this.pending || this.terminated);
  }
}
const win = new EventTarget();
const doc = new EventTarget();
doc.visibilityState = "visible";
Object.assign(globalThis, { window: win, document: doc, Worker: FakeWorker });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userActivation: { isActive: true } } });
function hostFor(t) {
  const host = createPowComputeHost(policy);
  t.after(() => { host.dispose(); doc.visibilityState = "visible"; navigator.userActivation.isActive = true; });
  return host;
}

test("optimized kernel matches independent ABI/Keccak across nonce boundaries", () => {
  const prep = prepare(job);
  for (const hi of [0, 1, 0x7fffffff, 0xffffffff]) for (const ctr of [0, 1, 255, 65535, 0x7fffffff, 0xffffffff]) {
    const nonce = nonceHex(job.nonceHigh, hi, ctr);
    assert.equal(digestHex(prep, hi, ctr), verifyPowCandidate(job, nonce).digest);
  }
  assert.equal(job.anchorHash, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], ["0x" + "11".repeat(32), "0x" + "22".repeat(32)])));
});
test("prefix-equal candidates are retained for full 256-bit verification", () => {
  const prep = prepare(job), hash = digestHex(prep, 123, 456);
  assert.equal(search(prep, 123, 456, 1, Number(BigInt(hash) >> 224n), Number((BigInt(hash) >> 192n) & 0xffffffffn)), 456);
});
test("scope, encoding, difficulty, nonce and duration fail closed", t => {
  for (const patch of [{ chainId: 56 }, { miner: "0x" + "66".repeat(20) }, { domain: "0x" + "00".repeat(32) }, { target: "0x" + "ff".repeat(32) }, { target: "0x" + "00".repeat(32) }, { nonceHigh: "0x" + "ff".repeat(32) }, { anchorHash: "0x00" }]) {
    assert.throws(() => validatePowJob({ ...job, ...patch }, job));
  }
  const host = hostFor(t);
  assert.throws(() => host.compute.start({ ...request, durationMs: 30001 }), /invalid-duration/);
  assert.throws(() => host.compute.start({ ...request, profile: "arbitrary-script" }), /unsupported-profile/);
});
test("host approval, declared capability and visible user activation required", t => {
  for (const patch of [{ enabled: false }, { capabilities: [] }]) {
    const host = createPowComputeHost({ ...policy, ...patch });
    assert.equal(host.compute.available, false);
    assert.throws(() => host.compute.start(request), /unavailable/);
    host.dispose();
  }
  const host = hostFor(t);
  navigator.userActivation.isActive = false;
  assert.throws(() => host.compute.start(request), /activation/);
  navigator.userActivation.isActive = true;
  doc.visibilityState = "hidden";
  assert.throws(() => host.compute.start(request), /activation/);
});
test("Comlink sends only approved fields; stop/restart isolates pending old calls", async t => {
  const host = hostFor(t);
  const task = host.compute.start({ ...request, job: { ...job, privateKey: "must-not-cross-boundary" } });
  const worker = FakeWorker.all.at(-1);
  await until(() => worker.pending);
  assert.equal(worker.url, "/api/runtime/compute/flapcred-worker");
  assert.equal(worker.input.job.privateKey, undefined);
  assert.equal(worker.input.maxHashes, 10_000_000);
  assert.throws(() => host.compute.start(request), /busy/);
  await worker.respond({ type: "progress", hashes: 1000, nonces: [] });
  assert.equal(task.getSnapshot().hashes, 1000);
  const oldCall = worker.pending;
  task.stop();
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners.size, 0);
  const frozen = task.getSnapshot();
  const next = host.compute.start(request);
  oldCall.resolve({ type: "progress", hashes: 9000, nonces: [] });
  await until(() => FakeWorker.all.at(-1).pending);
  assert.equal(task.getSnapshot(), frozen);
  assert.equal(next.getSnapshot().hashes, 0);
  host.dispose();
  assert.equal(next.getSnapshot().state, "stopped");
  assert.throws(() => host.compute.start(request), /disposed/);
});
test("candidate is independently verified; equality is rejected", async t => {
  const prep = prepare(job);
  const ctr = search(prep, 7, 0, 1_000_000, 0x0000ffff, 0xffffffff);
  assert.notEqual(ctr, -1);
  const nonce = nonceHex(job.nonceHigh, 7, ctr);
  const result = verifyPowCandidate(job, nonce);
  assert.equal(result.valid, true);
  assert.equal(verifyPowCandidate({ ...job, target: result.digest }, nonce).valid, false);
  const host = hostFor(t), task = host.compute.start(request);
  await FakeWorker.all.at(-1).respond({ type: "progress", hashes: ctr + 1, nonces: [nonce] });
  assert.equal(task.getSnapshot().verified, 1);
  assert.equal(task.getSnapshot().digest, result.digest);
});
test("hidden page, pagehide, invalid batches and worker errors terminate", async t => {
  const host = hostFor(t);
  for (const trigger of [() => win.dispatchEvent(new Event("pagehide")), () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); }, () => FakeWorker.all.at(-1).respond({ hashes: -1 }), () => FakeWorker.all.at(-1).onerror(), () => FakeWorker.all.at(-1).onmessageerror()]) {
    const task = host.compute.start(request);
    await trigger();
    assert.notEqual(task.getSnapshot().state, "running");
    assert.equal(FakeWorker.all.at(-1).terminated, true);
    assert.equal(FakeWorker.all.at(-1).listeners.size, 0);
    doc.visibilityState = "visible";
  }
});
test("Comlink propagates remote errors and host releases its budget", async t => {
  const host = hostFor(t);
  for (const method of ["initialize", "nextBatch"]) {
    const task = host.compute.start(request);
    const worker = FakeWorker.all.at(-1);
    worker.api[method] = () => { throw new Error("intentional worker failure"); };
    await until(() => task.getSnapshot().state === "error");
    assert.equal(task.getSnapshot().reason, "worker-rpc-failed");
    assert.equal(worker.terminated, true);
    assert.equal(worker.listeners.size, 0);
  }
});
test("stopping settles an outstanding Comlink initialization or batch call", async () => {
  for (const method of ["initialize", "nextBatch"]) {
    const worker = new FakeWorker("client-test");
    const client = createPowWorkerClient(worker);
    try {
      let called = false;
      worker.api[method] = () => { called = true; return new Promise(() => {}); };
      const pending = method === "initialize" ? client.initialize({ job, durationMs: 1000, maxHashes: 1000 }) : client.nextBatch();
      await until(() => called);
      let settled = false;
      pending.then(value => { assert.equal(value, undefined); settled = true; });
      client.dispose();
      await until(() => settled);
      assert.equal(worker.terminated, true);
      assert.equal(worker.listeners.size, 0);
      assert.equal(await client.nextBatch(), undefined);
    } finally { client.dispose(); }
  }
});
test("immediate stop cancels initialization before it is sent", async t => {
  const host = hostFor(t), task = host.compute.start(request);
  const worker = FakeWorker.all.at(-1);
  task.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.input, undefined);
  assert.equal(task.getSnapshot().state, "stopped");
  assert.equal(worker.listeners.size, 0);
});
test("deadline terminates even a nonresponsive Comlink worker", async t => {
  const host = hostFor(t), task = host.compute.start({ ...request, durationMs: 100 });
  await until(() => task.getSnapshot().state === "completed");
  assert.equal(FakeWorker.all.at(-1).terminated, true);
  assert.equal(FakeWorker.all.at(-1).listeners.size, 0);
});
test("worker response uses enforced network/script/child-worker policy", async () => {
  const route = await readFile(new URL("../../app/api/runtime/compute/flapcred-worker/route.ts", import.meta.url), "utf8");
  assert.match(route, /"Content-Security-Policy"/);
  assert.match(route, /connect-src 'none'; worker-src 'none'/);
});
