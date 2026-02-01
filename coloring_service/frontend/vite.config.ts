import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 프론트에서 /api, /uploads 를 백엔드(8000)로 프록시
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000"
    }
  }
});
