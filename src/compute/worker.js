// Fixed, self-contained worker; built by the host, never supplied by a Vault UI.
import { expose } from "comlink";
import { prepare, search, nonceHex } from "./keccak-core.js";

let state;
let busy = false;
const api = {
  initialize({ job, durationMs, maxHashes }) {
    if (state) throw new Error("compute/already-initialized");
    if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 30_000 || !Number.isInteger(maxHashes) || maxHashes < 1 || maxHashes > 10_000_000) {
      throw new Error("compute/invalid-budget");
    }
    state = {
      prep: prepare(job),
      nonceHigh: job.nonceHigh,
      targetHi: Number(BigInt(job.target) >> 224n),
      targetLo: Number((BigInt(job.target) >> 192n) & 0xffffffffn),
      hi: crypto.getRandomValues(new Uint32Array(1))[0],
      counter: 0,
      hashes: 0,
      deadline: performance.now() + durationMs,
      limit: maxHashes,
    };
  },
  async nextBatch() {
    if (!state) throw new Error("compute/not-initialized");
    if (busy) throw new Error("compute/batch-busy");
    busy = true;
    try {
      const s = state;
      const nonces = [];
      const reportAt = performance.now() + 250;
      while (s.hashes < s.limit && performance.now() < s.deadline && performance.now() < reportAt && nonces.length < 8) {
        const count = Math.min(10_000, s.limit - s.hashes, 0x100000000 - s.counter);
        const hit = search(s.prep, s.hi, s.counter, count, s.targetHi, s.targetLo);
        s.hashes += hit < 0 ? count : hit - s.counter + 1;
        if (hit >= 0) nonces.push(nonceHex(s.nonceHigh, s.hi, hit));
        s.counter = hit >= 0 ? hit + 1 : s.counter + count;
        if (s.counter >= 0x100000000) { s.hi = (s.hi + 1) >>> 0; s.counter = 0; }
        await new Promise(resolve => setTimeout(resolve, 8));
      }
      return { type: s.hashes >= s.limit || performance.now() >= s.deadline ? "done" : "progress", hashes: s.hashes, nonces };
    } finally {
      busy = false;
    }
  },
};

// No component-supplied callbacks or proxies cross the boundary. The host pulls bounded batches.
expose(api, self);
