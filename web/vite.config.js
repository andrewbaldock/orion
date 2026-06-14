import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the Bun backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 = website, 5174 = aether, 5175 = website (2nd); Orion owns 5176 and refuses to wander.
    port: 5176,
    strictPort: true,
    // Caddy fronts dev at https://orion.hunt → :5176; allow that Host header.
    allowedHosts: ["orion.hunt"],
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist" },
});
