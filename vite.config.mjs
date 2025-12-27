import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = process.cwd();

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true
  },
  resolve: {
    alias: {
      "lipsync-en.mjs": resolve(root, "node_modules/@met4citizen/talkinghead/modules/lipsync-en.mjs"),
      "lipsync-fi.mjs": resolve(root, "node_modules/@met4citizen/talkinghead/modules/lipsync-fi.mjs"),
      "lipsync-lt.mjs": resolve(root, "node_modules/@met4citizen/talkinghead/modules/lipsync-lt.mjs")
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true
  },
  assetsInclude: ["**/*.glb", "**/*.bin", "**/*.wav"],
  optimizeDeps: {
    exclude: [
      "@met4citizen/talkinghead",
      "lipsync-en",
      "lipsync-fi",
      "lipsync-lt",
      "lipsync-en.mjs",
      "lipsync-fi.mjs",
      "lipsync-lt.mjs",
      "@met4citizen/talkinghead/modules/lipsync-en.mjs",
      "@met4citizen/talkinghead/modules/lipsync-fi.mjs",
      "@met4citizen/talkinghead/modules/lipsync-lt.mjs"
    ]
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        headaudio: resolve(root, "head-audio.html"),
        e2e: resolve(root, "e2e.html"),
        conversation: resolve(root, "mlx-conversation.html"),
        stage: resolve(root, "stage.html"),
        "engine-lab": resolve(root, "engine-lab.html"),
        "multi-modal": resolve(root, "multi-modal.html"),
        "gestures-lab": resolve(root, "gestures-lab.html"),
        "dance-studio": resolve(root, "dance-studio.html"),
        info: resolve(root, "info.html"),
        settings: resolve(root, "settings.html")
      }
    }
  }
});
