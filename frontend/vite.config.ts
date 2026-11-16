import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // changeOrigin: false conserva la cabecera Host original (localhost:5173). Con la forma abreviada Vite la cambia
    // a 127.0.0.1:3000 y el servidor rechaza por seguridad las peticiones POST (el Origin ya no coincide con el Host).
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
});
