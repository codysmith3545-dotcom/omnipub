import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    clean: true,
    splitting: false,
    sourcemap: true,
    target: "node20",
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: "node20",
  },
]);
