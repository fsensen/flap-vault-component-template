import { defineConfig } from "tsup";

const runtimeExternals = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "wagmi",
  "viem",
  "@tanstack/react-query",
  "@rainbow-me/rainbowkit",
];

export default defineConfig({
  entry: {
    sdk: "src/sdk/client.ts",
    host: "src/sdk/host.ts",
    server: "src/sdk/server.ts",
    ui: "src/ui/public.ts",
  },
  tsconfig: "tsconfig.runtime-package.json",
  format: ["esm"],
  bundle: true,
  dts: true,
  sourcemap: true,
  minify: false,
  // sdk.js and ui.js must share one RuntimeContext instance so controlled UI
  // primitives can consume the provider without caller-supplied SDK props.
  splitting: true,
  clean: true,
  target: "es2020",
  outDir: "dist/vault-runtime",
  external: runtimeExternals,
  // Keep host RPC and the fixed worker self-contained; consumers need no Comlink import.
  noExternal: ["comlink"],
  treeshake: true,
  // Published JS must import its JSX runtime instead of relying on a host React global.
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  outExtension() {
    return {
      js: ".js",
    };
  },
});
