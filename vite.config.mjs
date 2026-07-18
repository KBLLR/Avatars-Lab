import { defineConfig } from "vite";
import { basename, extname, relative, resolve, sep } from "node:path";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";

const root = process.cwd();
const avatarLabsPort = Number(
  process.env.AVATAR_LABS_VITE_PORT || process.env.AVATAR_LABS_DEV_PORT || 5185,
);
const corexGatewayUrl = (
  process.env.COREX_GATEWAY_URL || process.env.VITE_COREX_GATEWAY_URL || "http://127.0.0.1:8090"
).replace(/\/$/, "");

const COREX_PUBLIC = resolve(
  process.env.AVATAR_LABS_COREX_PUBLIC_ROOT || resolve(root, "../../core-x/ui/public"),
);
const PERFORMANCE_ANIMATION_ROOT = resolve(
  process.env.AVATAR_LABS_ANIMATION_ROOT ||
    resolve(root, "../../houses/rigging-portal/public/animation-library/fbx"),
);
const RPM_ANIMATION_ROOT = resolve(
  process.env.AVATAR_LABS_RPM_ANIMATION_ROOT ||
    resolve(root, "../../houses/project-anja/frontend/anjadesk/public/assets/animations/mixamo"),
);

const contentTypes = {
  ".bin": "application/octet-stream",
  ".exr": "image/x-exr",
  ".fbx": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "image/vnd.radiance",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".ktx2": "image/ktx2",
  ".png": "image/png",
  ".webp": "image/webp",
};

const registerStaticRoot = (middlewares, route, staticRoot) => {
  middlewares.use(route, (req, res, next) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "invalid_asset_path", route }));
      return;
    }
    const filePath = resolve(staticRoot, `.${urlPath}`);
    const relativePath = relative(staticRoot, filePath);
    const isContained = relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
    if (!isContained || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "asset_not_found", route, path: urlPath }));
      return;
    }
    const stats = statSync(filePath);
    res.setHeader("Content-Type", contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    const range = typeof req.headers.range === "string"
      ? req.headers.range.match(/^bytes=(\d+)-(\d*)$/)
      : null;
    if (range) {
      const start = Math.min(Number(range[1]), stats.size - 1);
      const requestedEnd = range[2] ? Number(range[2]) : stats.size - 1;
      const end = Math.max(start, Math.min(requestedEnd, stats.size - 1));
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      res.setHeader("Content-Length", end - start + 1);
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.setHeader("Content-Length", stats.size);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  });
};

const listFiles = (directory, extension) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path, extension);
    return entry.isFile() && extname(entry.name).toLowerCase() === extension ? [path] : [];
  });
};

const slugify = (value) => value
  .toLowerCase()
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const titleize = (value) => value
  .replace(/\.[^.]+$/, "")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const classifyAnimation = (value) => {
  const name = value.toLowerCase();
  if (/idle|sitting/.test(name)) return "idle";
  if (/dance|dancing|salsa|soul|shuffl|maraschino/.test(name)) return "dance";
  if (/walk|run|sprint|jump|fall|land|pacing|crouch/.test(name)) return "locomotion";
  if (/talk|phone|wave|argu|yell/.test(name)) return "gesture";
  return "action";
};

const estimateAnimationDuration = (category, name) => {
  if (category === "dance") return 8_000;
  if (category === "idle") return 6_000;
  if (category === "locomotion") return /jump|fall|land/i.test(name) ? 2_800 : 4_500;
  return 3_500;
};

const encodeAssetPath = (value) => value.split("/").map(encodeURIComponent).join("/");

const buildAnimationCatalog = () => {
  const curated = listFiles(PERFORMANCE_ANIMATION_ROOT, ".fbx").map((file) => {
    const filename = basename(file);
    const category = classifyAnimation(filename);
    const rig = filename.includes("_rpm_")
      ? "rpm"
      : filename.includes("_mixamo_")
        ? "mixamo"
        : "humanoid";
    const label = titleize(filename)
      .replace(/\b(Humanoid|Mixamo|Rpm)\b/g, "")
      .replace(/\s+\d+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      id: `curated:${slugify(filename)}`,
      label,
      url: `/performance-assets/animations/${encodeURIComponent(filename)}`,
      durationMs: estimateAnimationDuration(category, filename),
      loop: ["dance", "idle", "locomotion"].includes(category),
      category,
      source: "rigging-portal-curated",
      rig,
      body: "any",
      tags: [category, rig, "curated", "normalized"],
    };
  });

  const rpm = listFiles(RPM_ANIMATION_ROOT, ".fbx").map((file) => {
    const path = relative(RPM_ANIMATION_ROOT, file).split(sep).join("/");
    const filename = basename(file);
    const body = path.startsWith("feminine/") ? "F" : path.startsWith("masculine/") ? "M" : "any";
    const category = classifyAnimation(filename);
    return {
      id: `rpm:${body.toLowerCase()}:${slugify(filename)}`,
      label: titleize(filename).replace(/\s+(\d+)$/, " $1"),
      url: `/performance-assets/rpm/${encodeAssetPath(path)}`,
      durationMs: estimateAnimationDuration(category, filename),
      loop: ["dance", "idle", "locomotion", "gesture"].includes(category),
      category,
      source: "ready-player-me",
      rig: "rpm",
      body,
      tags: [category, "rpm", body === "F" ? "feminine" : body === "M" ? "masculine" : "unisex"],
    };
  });

  const categoryRank = new Map(["idle", "dance", "locomotion", "gesture", "action"].map((value, index) => [value, index]));
  const animations = [...curated, ...rpm].sort((a, b) =>
    (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99) || a.label.localeCompare(b.label),
  );
  return {
    schema: "avatar-labs.animation-catalog.v1",
    generatedAt: new Date().toISOString(),
    animations,
    summary: {
      total: animations.length,
      curated: curated.length,
      rpm: rpm.length,
      available: {
        curated: existsSync(PERFORMANCE_ANIMATION_ROOT),
        rpm: existsSync(RPM_ANIMATION_ROOT),
      },
    },
  };
};

const registerAnimationCatalog = (middlewares) => {
  middlewares.use("/performance-assets/catalog.json", (_req, res) => {
    const payload = buildAnimationCatalog();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(JSON.stringify(payload));
  });
};

// Large canonical binaries stay in their owning surfaces. Avatar Labs exposes
// read-only local bridges in dev/preview rather than copying them into this repo.
const ecosystemAssetsPlugin = () => ({
  name: "ecosystem-assets",
  configureServer(server) {
    registerAnimationCatalog(server.middlewares);
    registerStaticRoot(server.middlewares, "/corex-assets", COREX_PUBLIC);
    registerStaticRoot(
      server.middlewares,
      "/performance-assets/animations",
      PERFORMANCE_ANIMATION_ROOT,
    );
    registerStaticRoot(server.middlewares, "/performance-assets/rpm", RPM_ANIMATION_ROOT);
  },
  configurePreviewServer(server) {
    registerAnimationCatalog(server.middlewares);
    registerStaticRoot(server.middlewares, "/corex-assets", COREX_PUBLIC);
    registerStaticRoot(
      server.middlewares,
      "/performance-assets/animations",
      PERFORMANCE_ANIMATION_ROOT,
    );
    registerStaticRoot(server.middlewares, "/performance-assets/rpm", RPM_ANIMATION_ROOT);
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
  plugins: [ecosystemAssetsPlugin()],
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
