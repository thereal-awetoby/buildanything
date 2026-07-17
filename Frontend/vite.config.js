import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Anything the client sends to /api gets forwarded to the Express
      // server in server/index.js, which holds the real Anthropic API key.
      "/api": "http://localhost:3001",
    },
  },
});
