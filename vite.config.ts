import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "chrome105",
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), buddy: resolve(__dirname, "buddy.html") },
    },
  },
});
