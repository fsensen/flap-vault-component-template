import { releaseProxy, wrap } from "comlink";
import type { Endpoint } from "comlink";
import type { PowWorkerApi, PowWorkerInput } from "./protocol";

/** Own the Comlink endpoint so termination also detaches listeners and settles callers. */
export function createPowWorkerClient(worker: Worker) {
  let closed = false;
  const abort = new AbortController();
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const endpoint: Endpoint = {
    postMessage(message, transfer) {
      // A Comlink finalizer can run after an explicit stop. It must not revive the worker.
      if (!closed) worker.postMessage(message, transfer ?? []);
    },
    addEventListener(type, listener) {
      if (closed) return;
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
      worker.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
      worker.removeEventListener(type, listener);
    },
  };
  const remote = wrap<PowWorkerApi>(endpoint);

  function call<T>(invoke: () => Promise<T>): Promise<T | undefined> {
    if (closed) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const onAbort = () => resolve(undefined);
      abort.signal.addEventListener("abort", onAbort, { once: true });
      // Comlink cannot reject an in-flight RPC after Worker.terminate(); settle our wait locally.
      Promise.resolve().then(() => closed ? undefined : invoke()).then(
        value => { abort.signal.removeEventListener("abort", onAbort); resolve(value); },
        error => { abort.signal.removeEventListener("abort", onAbort); reject(error); },
      );
    });
  }

  return {
    initialize: (input: PowWorkerInput) => call(() => remote.initialize(input)),
    nextBatch: () => call(() => remote.nextBatch()),
    dispose() {
      if (closed) return;
      // Release clears Comlink's pending call map. Termination remains immediate and unconditional.
      try { remote[releaseProxy](); } finally {
        closed = true;
        abort.abort();
        for (const [type, set] of listeners) for (const listener of set) worker.removeEventListener(type, listener);
        listeners.clear();
        worker.terminate();
      }
    },
  };
}
