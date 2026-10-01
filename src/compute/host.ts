import { encodeAbiParameters, keccak256 } from "viem";
import { POW_PROFILE, unavailableCompute } from "../sdk/compute";
import type { FlapCompute, PowJob, PowSnapshot, PowTask } from "../sdk/compute";
import { createPowWorkerClient } from "./workerClient";

export interface PowHostPolicy {
  enabled: boolean;
  capabilities: readonly string[];
  /** Host-approved scope, never copied from an untrusted component request. */
  scope: Pick<PowJob, "chainId" | "contract" | "miner" | "domain">;
}
export const POW_WORKER_PATH = "/api/runtime/compute/flapcred-worker";
export const MAX_POW_DURATION_MS = 30_000;
export const MAX_POW_HASHES = 10_000_000;
let occupied = false;

export function validatePowJob(job: PowJob, scope: PowHostPolicy["scope"]) {
  if (!job || !Number.isSafeInteger(job.chainId) || job.chainId <= 0) throw new Error("compute/invalid-job");
  for (const key of ["domain", "anchorHash", "nonceHigh", "target"] as const) {
    if (!/^0x[0-9a-f]{64}$/i.test(job[key])) throw new Error("compute/invalid-job");
  }
  for (const key of ["contract", "miner"] as const) {
    if (!/^0x[0-9a-f]{40}$/i.test(job[key]) || BigInt(job[key]) === 0n) throw new Error("compute/invalid-job");
  }
  if (job.chainId !== scope.chainId || ["contract", "miner", "domain"].some(
    key => job[key as "contract"].toLowerCase() !== scope[key as "contract"].toLowerCase(),
  )) throw new Error("compute/scope-mismatch");
  if (!job.nonceHigh.endsWith("0000000000000000") || BigInt(job.target) <= 0n || BigInt(job.target) >= 1n << 240n) {
    throw new Error("compute/invalid-target-or-nonce");
  }
}

/** Independent full 256-bit reference, separate from the optimized worker kernel. */
export function verifyPowCandidate(job: PowJob, nonce: `0x${string}`) {
  if (!/^0x[0-9a-f]{64}$/i.test(nonce) || nonce.slice(0, 50).toLowerCase() !== job.nonceHigh.slice(0, 50).toLowerCase()) {
    throw new Error("compute/invalid-result");
  }
  const digest = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
    [job.domain, BigInt(job.chainId), job.contract, job.anchorHash, job.miner, BigInt(nonce)],
  ));
  return { digest, valid: BigInt(digest) < BigInt(job.target) };
}

/** Host-only service. Create once per mount/scope; dispose on unmount or scope change. */
export function createPowComputeHost(policy: PowHostPolicy): { compute: FlapCompute; dispose(): void } {
  const scope = Object.freeze({ ...policy.scope });
  let disposed = false;
  let current: PowTask | undefined;
  const authorized = policy.enabled && policy.capabilities.includes(POW_PROFILE);
  const dispose = () => { disposed = true; current?.stop(); };
  if (!authorized) return { compute: unavailableCompute, dispose };

  const compute: FlapCompute = {
    available: true,
    start(request) {
      if (disposed) throw new Error("compute/disposed");
      if (request?.profile !== POW_PROFILE) throw new Error("compute/unsupported-profile");
      if (typeof window === "undefined" || !navigator.userActivation?.isActive || document.visibilityState !== "visible") {
        throw new Error("compute/user-activation-required");
      }
      if (occupied) throw new Error("compute/busy");
      const { domain, chainId, contract, anchorHash, miner, nonceHigh, target } = request.job ?? {};
      const job = Object.freeze({ domain, chainId, contract, anchorHash, miner, nonceHigh, target });
      validatePowJob(job, scope);
      const durationMs = request.durationMs ?? MAX_POW_DURATION_MS;
      if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > MAX_POW_DURATION_MS) throw new Error("compute/invalid-duration");
      const worker = new Worker(POW_WORKER_PATH, { name: POW_PROFILE });
      const client = createPowWorkerClient(worker);
      occupied = true;
      const started = performance.now();
      const listeners = new Set<() => void>();
      let snapshot: PowSnapshot = Object.freeze({ state: "running", hashes: 0, verified: 0, elapsedMs: 0 });
      let ended = false;
      let timer: ReturnType<typeof setTimeout>;
      const emit = (next: PowSnapshot) => {
        snapshot = Object.freeze(next);
        for (const listener of listeners) { try { listener(); } catch { /* Isolate component subscribers. */ } }
      };
      const finish = (state: PowSnapshot["state"], reason: string) => {
        if (ended) return;
        ended = true;
        worker.onerror = null;
        worker.onmessageerror = null;
        client.dispose();
        clearTimeout(timer);
        window.removeEventListener("pagehide", hide);
        document.removeEventListener("visibilitychange", visibility);
        occupied = false;
        emit({ ...snapshot, state, reason, elapsedMs: performance.now() - started });
        listeners.clear();
      };
      const hide = () => finish("stopped", "page-hidden");
      const visibility = () => { if (document.visibilityState !== "visible") hide(); };
      const task: PowTask = {
        getSnapshot: () => snapshot,
        subscribe(listener) { if (!ended) listeners.add(listener); return () => { listeners.delete(listener); }; },
        stop: () => finish("stopped", "user-or-context"),
      };
      current = task;
      worker.onerror = () => finish("error", "worker-error");
      worker.onmessageerror = () => finish("error", "worker-message-error");
      const acceptBatch = (data: unknown) => {
        if (ended) return;
        try {
          const batch = data as { type?: string; hashes: number; nonces: `0x${string}`[] } | null;
          if (!batch || !["progress", "done"].includes(batch.type ?? "") || !Number.isSafeInteger(batch.hashes) || batch.hashes < snapshot.hashes || batch.hashes > MAX_POW_HASHES || !Array.isArray(batch.nonces) || batch.nonces.length > 8) {
            throw new Error("compute/invalid-worker-message");
          }
          let next = { ...snapshot, hashes: batch.hashes, elapsedMs: performance.now() - started };
          for (const nonce of batch.nonces) {
            const result = verifyPowCandidate(job, nonce);
            if (result.valid) next = { ...next, verified: next.verified + 1, nonce, digest: result.digest };
          }
          emit(next);
          if (batch.type === "done") finish("completed", "budget");
        } catch { finish("error", "invalid-worker-result"); }
      };
      timer = setTimeout(() => finish("completed", "time-limit"), durationMs);
      window.addEventListener("pagehide", hide);
      document.addEventListener("visibilitychange", visibility);
      async function run() {
        try {
          await client.initialize({ job, durationMs, maxHashes: MAX_POW_HASHES });
          while (!ended) {
            const batch = await client.nextBatch();
            if (!ended) acceptBatch(batch);
          }
        } catch { finish("error", "worker-rpc-failed"); }
      }
      void run();
      return task;
    },
  };
  return { compute: Object.freeze(compute), dispose };
}
