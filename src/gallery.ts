import {
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  kind: "body" | "head";
  url: string;
}

interface RuntimeManifestPayload {
  avatars?: Array<Omit<ManifestAvatar, "kind" | "url">>;
  unavailable?: string[];
}

type GalleryFilterMode = "all" | "rigged" | "head-only" | "clips";

const COREX_HEADS = [
  "kbllr",
  "anja",
  "david",
  "eli",
  "nino",
  "nyx",
  "sofia",
  "susi-q",
  "vee",
];

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const galGrid = byId<HTMLElement>("galGrid");
const galSearch = byId<HTMLInputElement>("galSearch");
const galStatusBadge = byId<HTMLElement>("galStatusBadge");
const statTotal = byId<HTMLElement>("statTotal");
const statRigged = byId<HTMLElement>("statRigged");
const statHeadOnly = byId<HTMLElement>("statHeadOnly");
const statClips = byId<HTMLElement>("statClips");
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
scene.background = new Color(0x0c0e11);

const camera = new PerspectiveCamera(35, 1, 0.05, 60);
camera.position.set(0, 1.35, 3.2);

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.9, 0);

const hemi = new HemisphereLight(0xeef5ff, 0x262930, 1.2);
const key = new DirectionalLight(0xffffff, 1.5);
key.position.set(2.5, 4, 3);
const grid = new GridHelper(6, 12, 0x3b4450, 0x1d2228);
scene.add(hemi, key, grid);

const loader = new GLTFLoader();

let loadedRoot: import("three").Object3D | null = null;
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
  if (loadedRoot) {
    scene.remove(loadedRoot);
    loadedRoot.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry?.dispose();
      }
    });
    loadedRoot = null;
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
  if (!loadedRoot) return;
  loadedRoot.traverse((obj) => {
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
  statHeadOnly.textContent = String(allEntries.filter((e) => e.rig?.rigStatus === "head-only").length);
  statClips.textContent = String(allEntries.filter((e) => (e.rig?.embeddedAnimationCount || 0) > 0).length);
  statMissing.textContent = String(unavailableCount);
}

function matchesFilter(item: ManifestAvatar): boolean {
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
        ? `ARMATURE · ${rig.jointCount} BONES`
        : rig?.rigStatus === "head-only"
          ? `HEAD ONLY · ${rig.morphTargetCount} MORPHS`
          : "UNSCANNED";

      return `
        <button type="button" class="gal-card ${selected ? "is-selected" : ""}" data-avatar-id="${item.id}">
          <div class="gal-card__top">
            <span class="gal-card__kind">${item.kind === "head" ? "COREX HEAD" : `BODY · ${item.body || "?"}`}</span>
            <span class="gal-pill ${pillClass}">${pillText}</span>
          </div>
          <div class="gal-card__title">${item.display_name || item.id}</div>
          <div class="gal-card__meta">
            <span>Skins: ${rig ? rig.skinCount : "-"}</span>
            <span>Morphs: ${rig ? rig.morphTargetCount : "-"}</span>
            <span>Clips: ${rig ? rig.embeddedAnimationCount : "-"}</span>
            <span>Size: ${formatMb(item.sizeBytes)}</span>
          </div>
          <div class="gal-card__tags">
            ${rig?.m2mrFbxReady ? `<span class="gal-tag">M2MR FBX</span>` : ""}
            ${(item.tags || []).slice(0, 3).map((tag) => `<span class="gal-tag">${tag}</span>`).join("")}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderActionLinks(item: ManifestAvatar) {
  const encoded = encodeURIComponent(item.id);
  const links: Array<{ label: string; href: string }> =
    item.kind === "head"
      ? [
          { label: "Open in Core-X Head", href: `/corex-head.html?head=${encoded}` },
          { label: "Open in Performance Engine", href: "/engine-lab.html" },
        ]
      : [
          { label: "Open in Stage", href: `/stage.html?avatar=${encoded}` },
          { label: "Open in Dance Studio", href: "/dance-studio.html" },
          { label: "Open in Mocap Lab", href: "/mocap-lab.html" },
          { label: "Open in Performance Engine", href: "/engine-lab.html" },
        ];

  galActions.innerHTML = links
    .map((link) => `<a class="gal-btn" href="${link.href}">${link.label}</a>`)
    .join("");
}

async function inspectEntry(item: ManifestAvatar) {
  selectedId = item.id;
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

    loadedRoot = gltf.scene;
    scene.add(loadedRoot);

    const boneSet = new Set<string>();
    const skinNames: string[] = [];
    let skinnedCount = 0;
    let maxMorphs = 0;

    loadedRoot.traverse((obj) => {
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

    const box = new Box3().setFromObject(loadedRoot);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    controls.target.copy(center);
    const dist = Math.max(size.length() * 1.4, 0.9);
    camera.position.set(center.x + dist * 0.35, center.y + size.y * 0.2, center.z + dist);
    controls.update();

    if (boneSet.size > 0) {
      skeletonHelper = new SkeletonHelper(loadedRoot);
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

    runtimeBadge.textContent = hasRealArmature ? "ARMATURE VERIFIED" : maxMorphs > 0 ? "RIG-LESS HEAD" : "STATIC MESH";
    runtimeBadge.className = hasRealArmature ? "gal-pill gal-pill--ok" : "gal-pill gal-pill--warn";

    kvArmature.textContent = hasRealArmature ? "YES (SKIN + BONES)" : "NO ARMATURE";
    kvSkins.textContent = String(skinnedCount);
    kvBones.textContent = String(boneSet.size);
    kvMorphs.textContent = String(maxMorphs);
    kvClips.textContent = String(gltf.animations.length);
    kvFbx.textContent = item.rig.m2mrFbxReady ? "READY" : "NONE";

    if (gltf.animations.length > 0) {
      mixer = new AnimationMixer(loadedRoot);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
      clipPlaying = true;
      playClipBtn.disabled = false;
      playClipBtn.textContent = "Pause Clip";
    }

    const boneList = Array.from(boneSet);
    galBones.textContent =
      boneList.length > 0
        ? boneList.join(" · ")
        : maxMorphs > 0
          ? `No armature bones (head bust with ${maxMorphs} ARKit/morph blendshapes).`
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

async function init() {
  try {
    const res = await fetch("/avatars/runtime-manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as RuntimeManifestPayload;
    const bodies: ManifestAvatar[] = (payload.avatars || []).map((a) => ({
      ...a,
      kind: "body",
      url: `/avatars/${a.file}`,
    }));
    const heads: ManifestAvatar[] = COREX_HEADS.map((id) => ({
      id: `head:${id}`,
      file: `${id}.glb`,
      display_name: `${id.toUpperCase()} Head`,
      kind: "head",
      url: `/corex-assets/avatars/heads/${id}/${id}.glb`,
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
    allEntries = [...bodies, ...heads];
    updateStats((payload.unavailable || []).length);
    galStatusBadge.textContent = `${bodies.filter((b) => b.rig?.armatureVerified).length} ARMATURES · ${heads.length} HEADS`;
    renderGrid();
    if (allEntries[0]) void inspectEntry(allEntries[0]);
  } catch (error) {
    galStatusBadge.textContent = "MANIFEST ERROR";
    galStatusBadge.className = "gal-pill gal-pill--err";
    galGrid.textContent = error instanceof Error ? error.message : String(error);
  }
}

void init();
