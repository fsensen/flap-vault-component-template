import { source, sha256 } from "@/dist/vault-runtime-pow/compute-worker.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  if (process.env.NODE_ENV !== "development" || process.env.FLAP_POW_LOCAL !== "1") return new Response(null, { status: 404 });
  return new Response(source, { headers: {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'none'; connect-src 'none'; worker-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "X-Flap-Worker-Sha256": sha256,
  } });
}
