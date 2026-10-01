/** Fixed CPU profile. No script, URL, wallet or transaction data enters the worker. */
export const POW_PROFILE = "flapcred-keccak-cpu-v1" as const;
export interface PowJob {
  domain: `0x${string}`;
  chainId: number;
  contract: `0x${string}`;
  anchorHash: `0x${string}`;
  miner: `0x${string}`;
  nonceHigh: `0x${string}`;
  target: `0x${string}`;
}
export type PowState = "running" | "stopped" | "completed" | "error";
export interface PowSnapshot {
  state: PowState;
  hashes: number;
  verified: number;
  elapsedMs: number;
  nonce?: `0x${string}`;
  digest?: `0x${string}`;
  reason?: string;
}
export interface PowTask {
  getSnapshot(): PowSnapshot;
  subscribe(listener: () => void): () => void;
  stop(): void;
}
export interface FlapCompute {
  readonly available: boolean;
  start(request: { profile: typeof POW_PROFILE; job: PowJob; durationMs?: number }): PowTask;
}
export const unavailableCompute: FlapCompute = Object.freeze({
  available: false,
  start(): never { throw new Error("compute/unavailable"); },
});
