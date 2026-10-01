"use client";
import { useEffect, useState } from "react";
import { VaultRuntimeProvider } from "@/src/sdk";
import type { VaultManifest } from "@/src/sdk";
import { createPowComputeHost } from "@/src/sdk/host";
import en from "@/res/content.json";
import zh from "@/res/content_zh.json";
import Component from "./Component";
const manifest = {"artifactId": "local-pow-test", "name": "Local PoW test", "i18n": ["en", "zh"], "capabilities": ["flapcred-keccak-cpu-v1"], "match": {"bindings": [{"chainId": 97, "vaultAddresses": ["0x3333333333333333333333333333333333333333"]}]}} as VaultManifest;
const scope = {"chainId": 97, "contract": "0x3333333333333333333333333333333333333333", "miner": "0x4444444444444444444444444444444444444444", "domain": "0xb89c2844bbff69cd768e656db4baa1f754523647654be61cb5d903a5d4dc0022"} as const;
const runtimeContext = { chainId: 97, vaultAddress: scope.contract, userAddress: scope.miner };
const copy = { en: en.powDemo, zh: zh.powDemo };
export default function PowDemo() {
  const [locale, setLocale] = useState<"en" | "zh">("zh");
  const [generation, setGeneration] = useState(0);
  const [service, setService] = useState<ReturnType<typeof createPowComputeHost>>();
  useEffect(() => {
    const next = createPowComputeHost({ enabled: true, capabilities: manifest.capabilities ?? [], scope });
    setService(next);
    return () => next.dispose();
  }, [generation]);
  const t = copy[locale];
  return <main style={{ minHeight: "100vh", background: "#070808", color: "hsl(210 20% 98%)", padding: "32px 16px", fontFamily: "SFRounded, ui-rounded, system-ui, sans-serif" }}>
    <div style={{ maxWidth: 720, margin: "0 auto", borderRadius: 12, border: "1px solid hsl(215 27.9% 16.9%)", padding: 20, display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><h1 style={{ fontSize: 20, fontWeight: 600 }}>{t.title}</h1><button onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>{t.language}</button></div>
      <p style={{ color: "hsl(217.9 10.6% 64.9%)", fontSize: 14 }}>{t.note}</p>
      <p style={{ fontSize: 12 }}>{t.scope} · flap-vault-component-template</p>
      {service ? <VaultRuntimeProvider manifest={manifest} i18n={copy} locale={locale} runtimeContext={runtimeContext} compute={service.compute}><Component /></VaultRuntimeProvider> : <p>{t.loading}</p>}
      <button style={{ justifySelf: "start", fontSize: 14, textDecoration: "underline" }} onClick={() => setGeneration(n => n + 1)}>{t.reset}</button>
    </div>
  </main>;
}
