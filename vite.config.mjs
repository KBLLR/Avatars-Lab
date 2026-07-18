import { defineConfig } from "vite";
import { relative, resolve, sep } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";

const root = process.cwd();
const avatarLabsPort = Number(
  process.env.AVATAR_LABS_VITE_PORT || process.env.AVATAR_LABS_DEV_PORT || 5185,
);
const corexGatewayUrl = (
  process.env.COREX_GATEWAY_URL || process.env.VITE_COREX_GATEWAY_URL || "http://127.0.0.1:8090"
).replace(/\/$/, "");

// Core-X static assets (ChatAvatar heads — ~89MB GLBs). The canonical copies
// live in the sibling core-x checkout; the house streams them from disk in
// dev instead of duplicating the binaries into its own repo or depending on
// the core-x dev server being up.
const COREX_PUBLIC = resolve(root, "../../core-x/ui/public");
const registerCorexAssets = (middlewares) => {
  middlewares.use("/corex-assets", (req, res, next) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = resolve(COREX_PUBLIC, `.${urlPath}`);
    const relativePath = relative(COREX_PUBLIC, filePath);
    const isContained = relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
    if (!isContained || !existsSync(filePath) || !statSync(filePath).isFile()) {
      next();
      return;
    }
    res.setHeader(
      "Content-Type",
      filePath.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream",
    );
    res.setHeader("Content-Length", statSync(filePath).size);
    createReadStream(filePath).pipe(res);
  });
};

const corexAssetsPlugin = () => ({
  name: "corex-assets",
  configureServer(server) {
    registerCorexAssets(server.middlewares);
  },
  configurePreviewServer(server) {
    registerCorexAssets(server.middlewares);
  },
});

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: avatarLabsPort,
    strictPort: true,
    proxy: {
      "/api/audio": {
        target: corexGatewayUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audio/, ""),
      },
      "/api/llm": {
        target: corexGatewayUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm/, ""),
      },
      "/api/said": {
        target: corexGatewayUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/said/, ""),
      },
      "/api/mflux": {
        target: corexGatewayUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mflux/, ""),
      },
    },
  },
  plugins: [corexAssetsPlugin()],
  resolve: {
    alias: {
      "lipsync-en.mjs": resolve(
        root,
        "node_modules/@met4citizen/talkinghead/modules/lipsync-en.mjs"
      ),
      "lipsync-fi.mjs": resolve(
        root,
        "node_modules/@met4citizen/talkinghead/modules/lipsync-fi.mjs"
      ),
      "lipsync-lt.mjs": resolve(
        root,
        "node_modules/@met4citizen/talkinghead/modules/lipsync-lt.mjs"
      ),
    },
  },
  preview: {
    host: "127.0.0.1",
    port: avatarLabsPort,
    strictPort: true,
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
      "@met4citizen/talkinghead/modules/lipsync-lt.mjs",
    ],
  },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(root, "index.html"),
        headaudio: resolve(root, "head-audio.html"),
        "gemma-avatar": resolve(root, "gemma-avatar.html"),
        "corex-head": resolve(root, "corex-head.html"),
        e2e: resolve(root, "e2e.html"),
        conversation: resolve(root, "mlx-conversation.html"),
        stage: resolve(root, "stage.html"),
        "engine-lab": resolve(root, "engine-lab.html"),
        "multi-modal": resolve(root, "multi-modal.html"),
        "gestures-lab": resolve(root, "gestures-lab.html"),
        "dance-studio": resolve(root, "dance-studio.html"),
        info: resolve(root, "info.html"),
        settings: resolve(root, "settings.html"),
        "composition-layer": resolve(root, "composition-layer.html"),
      },
    },
  },
});
