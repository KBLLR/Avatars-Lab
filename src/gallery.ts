import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  SRGBColorSpace,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  applyStudioMaterialRealism,
  centerAndFrameCoreXHead,
} from "./scene/studio-scene-template";
import {
  HEAD_ROSTER,
  normalizeChatAvatarHead,
  normalizeStandingBodyUpAxis,
} from "./scene/chat-avatar-head";
import {
  COREX_SELECT_CHARACTER_EVENT,
  fetchRiggingPortalCharacters,
  saveSelectedRiggingCharacter,
  type RiggingPortalCharacter,
} from "./runtime/rigging-portal-roster";

interface AvatarRigMeta {
  armatureVerified: boolean;
  rigStatus: "rigged" | "head-only" | "static" | "unknown";
  skinCount: number;
  jointCount: number;
  jointNamesSample: string[];
  morphTargetCount: number;
  embeddedAnimationCount: number;
  embeddedAnimations: string[];
  meshCount: number;
  m2mrFbxReady: boolean;
}

interface ManifestAvatar {
  id: string;
  file: string;
  display_name?: string;
  body?: "M" | "F";
  project?: string;
  tags?: string[];
  sizeBytes?: number;
  rig?: AvatarRigMeta;
  kind: "body" | "head" | "rigging-portal";
  url: string;
  hairUrl?: string;
  portalChar?: RiggingPortalCharacter;
}

interface RuntimeManifestPayload {
  avatars?: Array<Omit<ManifestAvatar, "kind" | "url">>;
  unavailable?: string[];
}

type GalleryFilterMode = "all" | "rigging-portal" | "rigged" | "head-only" | "clips";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const galGrid = byId<HTMLElement>("galGrid");
const galSearch = byId<HTMLInputElement>("galSearch");
const galStatusBadge = byId<HTMLElement>("galStatusBadge");
const statTotal = byId<HTMLElement>("statTotal");
const statRigged = byId<HTMLElement>("statRigged");
const statPortal = byId<HTMLElement>("statPortal");
const statHeadOnly = byId<HTMLElement>("statHeadOnly");
const statMissing = byId<HTMLElement>("statMissing");
const inspectorTitle = byId<HTMLElement>("inspectorTitle");
const runtimeBadge = byId<HTMLElement>("runtimeBadge");
const kvArmature = byId<HTMLElement>("kvArmature");
const kvSkins = byId<HTMLElement>("kvSkins");
const kvBones = byId<HTMLElement>("kvBones");
const kvMorphs = byId<HTMLElement>("kvMorphs");
const kvClips = byId<HTMLElement>("kvClips");
const kvFbx = byId<HTMLElement>("kvFbx");
const galBones = byId<HTMLElement>("galBones");
const galActions = byId<HTMLElement>("galActions");
const toggleSkeletonBtn = byId<HTMLButtonElement>("toggleSkeletonBtn");
const toggleMeshBtn = byId<HTMLButtonElement>("toggleMeshBtn");
const playClipBtn = byId<HTMLButtonElement>("playClipBtn");
const canvas = byId<HTMLCanvasElement>("galCanvas");

let allEntries: ManifestAvatar[] = [];
let activeFilter: GalleryFilterMode = "all";
let searchQuery = "";
let selectedId = "";
let showSkeleton = true;
let showWireframe = false;

const scene = new Scene();
scene.background = new Color(0x141516);

const camera = new PerspectiveCamera(38, 1, 0.02, 60);
camera.position.set(0, 1.35, 3.2);

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.9, 0);

// Canonical 3-point + hemisphere studio rig
const amb = new AmbientLight(0xffffff, 0.42);
const hemi = new HemisphereLight(0xeef5ff, 0x262930, 0.55);
const key = new DirectionalLight(0xfff8ef, 1.2);
key.position.set(1.2, 2.1, 2.8);
key.castShadow = true;
const fill = new DirectionalLight(0x90a4ff, 0.35);
fill.position.set(-1.3, 1.6, -2.2);
const rim = new PointLight(0xffe4cc, 0.8, 10);
rim.position.set(0, 2.2, -2.2);
const grid = new GridHelper(6, 12, 0x3b4450, 0x1d2228);
scene.add(amb, hemi, key, fill, rim, grid);

const loader = new GLTFLoader();

let loadedGroup: Group | null = null;
let skeletonHelper: SkeletonHelper | null = null;
let mixer: AnimationMixer | null = null;
let clipPlaying = false;
let loadSequence = 0;

function resizeStage() {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resizeStage);
if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

const clock = new Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (mixer && clipPlaying) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function disposeCurrentModel() {
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper.dispose();
    skeletonHelper = null;
  }
  if (loadedGroup) {
    scene.remove(loadedGroup);
    loadedGroup.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry?.dispose();
      }
    });
    loadedGroup = null;
  }
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  clipPlaying = false;
  playClipBtn.disabled = true;
  playClipBtn.textContent = "Play Clip";
}

function applyMeshWireframe(wireframe: boolean) {
  if (!loadedGroup) return;
  loadedGroup.traverse((obj) => {
    if (obj instanceof Mesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if ("wireframe" in mat) mat.wireframe = wireframe;
      }
    }
  });
}

function updateStats(unavailableCount: number) {
  statTotal.textContent = String(allEntries.length);
  statRigged.textContent = String(allEntries.filter((e) => e.rig?.armatureVerified).length);
  statPortal.textContent = String(allEntries.filter((e) => e.kind === "rigging-portal").length);
  statHeadOnly.textContent = String(allEntries.filter((e) => e.rig?.rigStatus === "head-only").length);
  statMissing.textContent = String(unavailableCount);
}

function matchesFilter(item: ManifestAvatar): boolean {
  if (activeFilter === "rigging-portal" && item.kind !== "rigging-portal") return false;
  if (activeFilter === "rigged" && !item.rig?.armatureVerified) return false;
  if (activeFilter === "head-only" && item.rig?.rigStatus !== "head-only") return false;
  if (activeFilter === "clips" && (item.rig?.embeddedAnimationCount || 0) === 0) return false;

  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    (item.display_name || item.id).toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    (item.project || "").toLowerCase().includes(q) ||
    (item.tags || []).some((t) => t.toLowerCase().includes(q)) ||
    (item.rig?.jointNamesSample || []).some((j) => j.toLowerCase().includes(q))
  );
}

function formatMb(bytes?: number) {
  return typeof bytes === "number" && bytes > 0 ? `${(bytes / 1048576).toFixed(1)} MB` : "-";
}

function renderGrid() {
  const visible = allEntries.filter(matchesFilter);
  if (visible.length === 0) {
    galGrid.innerHTML = `<p style="grid-column:1/-1;color:var(--workbench-muted);font-family:var(--workbench-mono);font-size:11px;">No characters match the active armature filter.</p>`;
    return;
  }

  galGrid.innerHTML = visible
    .map((item) => {
      const selected = item.id === selectedId;
      const rig = item.rig;
      const pillClass = rig?.armatureVerified
        ? "gal-pill--ok"
        : rig?.rigStatus === "head-only"
          ? "gal-pill--blue"
          : "gal-pill--warn";
      const pillText = rig?.armatureVerified
        ? rig.jointCount > 0
          ? `ARMATURE · ${rig.jointCount} BONES`
          : "RIGGING ARMATURE"
        : rig?.rigStatus === "head-only"
          ? `HEAD ONLY · ${rig.morphTargetCount} MORPHS`
          : "UNSCANNED";

      const kindLabel =
        item.kind === "head"
          ? "COREX HEAD"
          : item.kind === "rigging-portal"
            ? "RIGGING PORTAL"
            : `BODY · ${item.body || "?"}`;

      return `
        <button type="button" class="gal-card ${selected ? "is-selected" : ""}" data-avatar-id="${item.id}">
          <div class="gal-card__top">
            <span class="gal-card__kind">${kindLabel}</span>
            <span class="gal-pill ${pillClass}">${pillText}</span>
          </div>
          <div class="gal-card__title">${item.display_name || item.id}</div>
          <div class="gal-card__meta">
            <span>Skins: ${rig && rig.skinCount > 0 ? rig.skinCount : "-"}</span>
            <span>Morphs: ${rig ? rig.morphTargetCount : "-"}</span>
            <span>Clips: ${rig ? rig.embeddedAnimationCount : "-"}</span>
            <span>Size: ${formatMb(item.sizeBytes)}</span>
          </div>
          <div class="gal-card__tags">
            ${rig?.m2mrFbxReady ? `<span class="gal-tag">M2MR READY</span>` : ""}
            ${(item.tags || []).slice(0, 3).map((tag) => `<span class="gal-tag">${tag}</span>`).join("")}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderActionLinks(item: ManifestAvatar) {
  if (item.kind === "head") {
    const rawHead = item.id.replace(/^head:/, "");
    const encoded = encodeURIComponent(rawHead);
    galActions.innerHTML = `
      <a class="gal-btn" href="/corex-head.html?head=${encoded}">Open in Core-X Head</a>
      <a class="gal-btn" href="/engine-lab.html">Open in Performance Engine</a>
    `;
    return;
  }

  const encoded = encodeURIComponent(item.id);
  const usePortalParam = item.kind === "rigging-portal" ? `?avatar=${encoded}` : "";
  const buttons = [
    `<a class="gal-btn is-active" href="/mocap-lab.html${usePortalParam}" id="galUseMocapBtn">Use in Mocap Lab</a>`,
    `<a class="gal-btn" href="/stage.html?avatar=${encoded}">Open in Stage</a>`,
    `<a class="gal-btn" href="/dance-studio.html">Dance Studio</a>`,
    `<a class="gal-btn" href="/engine-lab.html">Performance Engine</a>`,
  ];
  galActions.innerHTML = buttons.join("");

  if (item.portalChar) {
    document.getElementById("galUseMocapBtn")?.addEventListener("click", () => {
      saveSelectedRiggingCharacter(item.portalChar!);
    });
  }
}

async function inspectEntry(item: ManifestAvatar) {
  selectedId = item.id;
  if (item.portalChar) saveSelectedRiggingCharacter(item.portalChar);
  renderGrid();
  inspectorTitle.textContent = item.display_name || item.id;
  runtimeBadge.textContent = "LOADING GLB";
  runtimeBadge.className = "gal-pill gal-pill--blue";
  renderActionLinks(item);
  disposeCurrentModel();

  const token = ++loadSequence;
  try {
    const gltf = await loader.loadAsync(item.url);
    if (token !== loadSequence) return;

    const rootGroup = new Group();
    loadedGroup = rootGroup;
    scene.add(rootGroup);

    const modelRoot = gltf.scene;
    rootGroup.add(modelRoot);

    if (item.kind === "head") {
      grid.visible = false;
      camera.fov = 55;
      camera.updateProjectionMatrix();

      normalizeChatAvatarHead(modelRoot);
      applyStudioMaterialRealism(modelRoot, false);

      if (item.hairUrl) {
        try {
          const hairGltf = await loader.loadAsync(item.hairUrl);
          if (token === loadSequence) {
            applyStudioMaterialRealism(hairGltf.scene, false);
            modelRoot.add(hairGltf.scene);
          }
        } catch {
          // Companion hair optional when missing for this head.
        }
      }
      centerAndFrameCoreXHead(rootGroup, camera, controls);
    } else {
      grid.visible = true;
      camera.fov = 38;
      camera.updateProjectionMatrix();

      // Stand Z-up exports (Adam, Donna, Eli) cleanly upright on Y+ ground
      normalizeStandingBodyUpAxis(rootGroup);
      applyStudioMaterialRealism(modelRoot, false);

      const box = new Box3().setFromObject(rootGroup);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      controls.target.copy(center);
      const dist = Math.max(size.length() * 1.35, 1.2);
      camera.position.set(center.x + dist * 0.25, center.y + size.y * 0.15, center.z + dist);
      controls.update();
    }

    const boneSet = new Set<string>();
    const skinNames: string[] = [];
    let skinnedCount = 0;
    let maxMorphs = 0;

    rootGroup.traverse((obj) => {
      if (obj instanceof SkinnedMesh) {
        skinnedCount += 1;
        skinNames.push(obj.name || `skin_${skinnedCount}`);
        if (obj.skeleton) {
          for (const bone of obj.skeleton.bones) {
            if (bone.name) boneSet.add(bone.name);
          }
        }
      }
      if (obj instanceof Mesh && obj.morphTargetInfluences) {
        maxMorphs = Math.max(maxMorphs, obj.morphTargetInfluences.length);
      }
    });

    if (boneSet.size > 0 && item.kind !== "head") {
      skeletonHelper = new SkeletonHelper(modelRoot);
      skeletonHelper.visible = showSkeleton;
      scene.add(skeletonHelper);
    }
    applyMeshWireframe(showWireframe);

    const hasRealArmature = skinnedCount > 0 && boneSet.size > 0;
    item.rig = {
      armatureVerified: hasRealArmature,
      rigStatus: hasRealArmature ? "rigged" : maxMorphs > 0 ? "head-only" : "static",
      skinCount: skinnedCount,
      jointCount: boneSet.size,
      jointNamesSample: Array.from(boneSet).slice(0, 16),
      morphTargetCount: maxMorphs,
      embeddedAnimationCount: gltf.animations.length,
      embeddedAnimations: gltf.animations.map((a) => a.name).filter(Boolean),
      meshCount: skinNames.length,
      m2mrFbxReady: item.rig?.m2mrFbxReady ?? false,
    };
    updateStats(Number(statMissing.textContent) || 0);
    renderGrid();

    runtimeBadge.textContent = hasRealArmature ? "ARMATURE VERIFIED" : maxMorphs > 0 ? "COREX HEAD" : "STATIC MESH";
    runtimeBadge.className = hasRealArmature ? "gal-pill gal-pill--ok" : "gal-pill gal-pill--blue";

    kvArmature.textContent = hasRealArmature ? "YES (SKIN + BONES)" : "NO ARMATURE";
    kvSkins.textContent = String(skinnedCount);
    kvBones.textContent = String(boneSet.size);
    kvMorphs.textContent = String(maxMorphs);
    kvClips.textContent = String(gltf.animations.length);
    kvFbx.textContent = item.rig.m2mrFbxReady ? "READY" : "NONE";

    // Prepare clip for explicit user playback (keep rest pose upright by default)
    if (gltf.animations.length > 0 && item.kind !== "head") {
      mixer = new AnimationMixer(modelRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
      clipPlaying = false;
      playClipBtn.disabled = false;
      playClipBtn.textContent = "Play Clip";
    }

    const boneList = Array.from(boneSet);
    galBones.textContent =
      boneList.length > 0
        ? boneList.join(" · ")
        : maxMorphs > 0
          ? `Canonical Core-X head (${maxMorphs} ARKit/morph blendshapes${item.hairUrl ? " + hair" : ""}).`
          : "No armature bones or morph targets found.";
  } catch (error) {
    if (token !== loadSequence) return;
    runtimeBadge.textContent = "LOAD FAILED";
    runtimeBadge.className = "gal-pill gal-pill--err";
    galBones.textContent = error instanceof Error ? error.message : String(error);
  }
}

galGrid.addEventListener("click", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-avatar-id]");
  if (!card) return;
  const item = allEntries.find((entry) => entry.id === card.dataset.avatarId);
  if (item) void inspectEntry(item);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
  btn.addEventListener("click", () => {
    activeFilter = (btn.dataset.filter as GalleryFilterMode) || "all";
    for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
      candidate.classList.toggle("is-active", candidate === btn);
    }
    renderGrid();
  });
}

galSearch.addEventListener("input", () => {
  searchQuery = galSearch.value;
  renderGrid();
});

toggleSkeletonBtn.addEventListener("click", () => {
  showSkeleton = !showSkeleton;
  if (skeletonHelper) skeletonHelper.visible = showSkeleton;
  toggleSkeletonBtn.classList.toggle("is-active", showSkeleton);
  toggleSkeletonBtn.textContent = showSkeleton ? "Bones ON" : "Bones OFF";
});

toggleMeshBtn.addEventListener("click", () => {
  showWireframe = !showWireframe;
  applyMeshWireframe(showWireframe);
  toggleMeshBtn.classList.toggle("is-active", showWireframe);
});

playClipBtn.addEventListener("click", () => {
  if (!mixer) return;
  clipPlaying = !clipPlaying;
  playClipBtn.textContent = clipPlaying ? "Pause Clip" : "Play Clip";
});

window.addEventListener(COREX_SELECT_CHARACTER_EVENT, (ev) => {
  const detail = (ev as CustomEvent<RiggingPortalCharacter>).detail;
  if (!detail?.id) return;
  const match = allEntries.find((item) => item.id === detail.id);
  if (match) void inspectEntry(match);
});

async function init() {
  try {
    const [manifestRes, portalData] = await Promise.all([
      fetch("/avatars/runtime-manifest.json", { cache: "no-store" }),
      fetchRiggingPortalCharacters(),
    ]);
    if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status}`);
    const payload = (await manifestRes.json()) as RuntimeManifestPayload;

    const bodies: ManifestAvatar[] = (payload.avatars || []).map((a) => ({
      ...a,
      kind: "body",
      url: `/avatars/${a.file}`,
    }));

    const localIds = new Set(bodies.map((b) => b.id));
    const portalEntries: ManifestAvatar[] = portalData.characters
      .filter((c) => !localIds.has(c.id))
      .map((c) => ({
        id: c.id,
        file: `${c.id}.glb`,
        display_name: c.displayName,
        tags: [c.sourceType, c.status, c.motionsCount > 0 ? `${c.motionsCount}m` : "armature"],
        kind: "rigging-portal",
        url: c.viewerUrl,
        portalChar: c,
        rig: {
          armatureVerified: true,
          rigStatus: "rigged",
          skinCount: 1,
          jointCount: 0,
          jointNamesSample: [],
          morphTargetCount: 0,
          embeddedAnimationCount: c.motionsCount,
          embeddedAnimations: [],
          meshCount: 1,
          m2mrFbxReady: Boolean(c.retargetTargetId),
        },
      }));

    const heads: ManifestAvatar[] = Object.values(HEAD_ROSTER).map((def) => ({
      id: `head:${def.id}`,
      file: `${def.id}.glb`,
      display_name: `${def.label} Head`,
      kind: "head",
      url: def.url,
      hairUrl: def.hairUrl,
      tags: ["corex-head", "arkit-51"],
      rig: {
        armatureVerified: false,
        rigStatus: "head-only",
        skinCount: 0,
        jointCount: 0,
        jointNamesSample: [],
        morphTargetCount: 51,
        embeddedAnimationCount: 0,
        embeddedAnimations: [],
        meshCount: 1,
        m2mrFbxReady: false,
      },
    }));

    allEntries = [...portalEntries, ...bodies, ...heads];
    updateStats((payload.unavailable || []).length);
    galStatusBadge.textContent = `${portalEntries.length} PORTAL · ${bodies.length} LOCAL · ${heads.length} HEADS`;
    renderGrid();
    if (allEntries[0]) void inspectEntry(allEntries[0]);
  } catch (error) {
    galStatusBadge.textContent = "MANIFEST ERROR";
    galStatusBadge.className = "gal-pill gal-pill--err";
    galGrid.textContent = error instanceof Error ? error.message : String(error);
  }
}

void init();
