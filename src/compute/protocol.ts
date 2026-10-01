import type { PowJob } from "../sdk/compute";

/** Private host-to-worker contract; the component-facing SDK never exposes this proxy. */
export interface PowWorkerInput {
  job: PowJob;
  durationMs: number;
  maxHashes: number;
}

export interface PowWorkerBatch {
  type: "progress" | "done";
  hashes: number;
  nonces: `0x${string}`[];
}

export interface PowWorkerApi {
  initialize(input: PowWorkerInput): void;
  nextBatch(): Promise<PowWorkerBatch>;
}
