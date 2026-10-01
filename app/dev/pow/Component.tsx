"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useFlapSdk, POW_PROFILE } from "@/src/sdk";
import type { PowJob, PowTask, PowSnapshot } from "@/src/sdk";
const job = {"domain": "0xb89c2844bbff69cd768e656db4baa1f754523647654be61cb5d903a5d4dc0022", "chainId": 97, "contract": "0x3333333333333333333333333333333333333333", "anchorHash": "0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871", "miner": "0x4444444444444444444444444444444444444444", "nonceHigh": "0x5555555555555555555555555555555555555555555555550000000000000000", "target": "0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"} as PowJob;
const idle = { state: "ready", hashes: 0, verified: 0, elapsedMs: 0, nonce: "", digest: "" };
const subscribeIdle = () => () => {};
const getIdle = () => idle;
const button = { padding: "8px 16px", borderRadius: 8, background: "hsl(250 100% 60%)", color: "hsl(210 20% 98%)", fontWeight: 600, cursor: "pointer" };
export default function PowComponent() {
  const sdk = useFlapSdk();
  const t = sdk.i18n.t;
  const [task, setTask] = useState<PowTask>();
  const [error, setError] = useState("");
  const [heartbeat, setHeartbeat] = useState(0);
  const snapshot = useSyncExternalStore<PowSnapshot | typeof idle>(task?.subscribe ?? subscribeIdle, task?.getSnapshot ?? getIdle, getIdle);
  useEffect(() => { const timer = setInterval(() => setHeartbeat(n => n + 1), 100); return () => clearInterval(timer); }, []);
  useEffect(() => () => task?.stop(), [task]);
  const start = () => {
    try { setError(""); setTask(sdk.compute?.start({ profile: POW_PROFILE, job })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <section style={{ display: "grid", gap: 16 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button style={{ ...button, opacity: snapshot.state === "running" ? .5 : 1 }} disabled={!sdk.compute?.available || snapshot.state === "running"} onClick={start}>{t("start")}</button>
      <button style={{ ...button, background: "hsl(215 27.9% 16.9%)", border: "1px solid hsl(217.9 10.6% 64.9%)", opacity: snapshot.state === "running" ? 1 : .5 }} disabled={snapshot.state !== "running"} onClick={() => task?.stop()}>{t("stop")}</button>
    </div>
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
      {[["status", t(snapshot.state)], ["hashes", snapshot.hashes.toLocaleString()], ["verified", snapshot.verified], ["heartbeat", heartbeat]].map(([key, value]) => <div key={key}><dt style={{ color: "hsl(217.9 10.6% 64.9%)", fontSize: 14 }}>{t(String(key))}</dt><dd data-testid={key} style={{ fontFamily: "monospace", fontSize: 20 }}>{value}</dd></div>)}
    </dl>
    <div style={{ overflowWrap: "anywhere", fontFamily: "monospace", fontSize: 12 }}><p>{t("nonce")}: <span data-testid="nonce">{snapshot.nonce || "—"}</span></p><p>{t("digest")}: <span data-testid="digest">{snapshot.digest || "—"}</span></p></div>
    {error && <p role="alert">{t("error")}: {error}</p>}
  </section>;
}
