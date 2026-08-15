import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const boxApiPattern = "^/box-api/(dashboard|whatsapp-status|recording/audio|messages/next|messages/[^/]+/(audio|played))$";
const certificate = new URL("../../.certs/lan-server.crt", import.meta.url);
const privateKey = new URL("../../.certs/lan-server.key", import.meta.url);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    allowedHosts: [".ngrok-free.app"],
    https: {
      cert: fs.readFileSync(certificate),
      key: fs.readFileSync(privateKey)
    },
    proxy: {
      [boxApiPattern]: {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        rewrite: (requestPath) => {
          if (requestPath === "/box-api/dashboard") return "/api/box/dashboard";
          if (requestPath === "/box-api/whatsapp-status") return "/api/box/status";
          return requestPath.replace(/^\/box-api/, "/api/admin/simulator");
        }
      }
    }
  }
});
