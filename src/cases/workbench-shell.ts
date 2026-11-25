import { ChevronDown, Grid3X3, Images, Users, X, createElement } from "lucide";
import { AVATAR_LAB_CASES } from "./registry";
import {
  fetchRiggingPortalCharacters,
  saveSelectedRiggingCharacter,
  type RiggingPortalCharacter,
} from "../runtime/rigging-portal-roster";

const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
const currentCase = AVATAR_LAB_CASES.find((item) => item.href === currentPath);
const galleries = [
  { caseId: "musetalk", href: "/talking-portrait.html", title: "Talking Portrait Gallery" },
  { caseId: "mocap-lab", href: "/gallery.html", title: "Rigged Character Gallery" },
];
const currentGallery = galleries.find((item) => item.href === currentPath);
const gallery = galleries.find((item) => item.caseId === currentCase?.id);
const parentCase = AVATAR_LAB_CASES.find((item) => item.id === currentGallery?.caseId);

document.body.dataset.avatarLabsWorkbench = "true";
if (currentCase) document.body.dataset.avatarLabsCase = currentCase.id;

const bar = document.createElement("header");
bar.className = "case-workbench-bar";
bar.setAttribute("aria-label", "Avatar Labs case navigation");

const launcherLink = document.createElement("a");
launcherLink.className = "case-workbench-bar__launcher";
launcherLink.href = "/";
launcherLink.title = "All Avatar Labs cases";
launcherLink.setAttribute("aria-label", "All Avatar Labs cases");
launcherLink.appendChild(createElement(Grid3X3, { width: 15, height: 15 }));

const identity = document.createElement("div");
identity.className = "case-workbench-bar__identity";
identity.innerHTML = `
  <span>Core-X / Avatar Labs</span>
  <strong>${currentCase?.title || currentGallery?.title || document.title}</strong>
`;

if (gallery || parentCase) {
  const link = document.createElement("a");
  link.className = "case-workbench-bar__gallery-link";
  link.href = gallery?.href ?? parentCase!.href;
  link.title = gallery ? `Open ${gallery.title}` : `Back to ${parentCase!.title}`;
  link.setAttribute("aria-label", link.title);
  link.appendChild(createElement(gallery ? Images : Grid3X3, { width: 16, height: 16 }));
  identity.appendChild(link);
}

const routePicker = document.createElement("label");
routePicker.className = "case-workbench-bar__picker";
routePicker.title = "Switch case";
const routeSelect = document.createElement("select");
routeSelect.setAttribute("aria-label", "Switch Avatar Labs case");
for (const item of AVATAR_LAB_CASES) {
  const option = document.createElement("option");
  option.value = item.href;
  option.textContent = `${item.code} / ${item.title}`;
  option.selected = item.href === currentPath || item.id === parentCase?.id;
  routeSelect.appendChild(option);
}
if (!currentCase && !currentGallery && currentPath !== "/") {
  const fallbackOption = document.createElement("option");
  fallbackOption.value = currentPath;
  fallbackOption.textContent = document.title || currentPath;
  fallbackOption.selected = true;
  routeSelect.appendChild(fallbackOption);
}
routeSelect.addEventListener("change", () => {
  window.location.assign(routeSelect.value);
});
routePicker.append(routeSelect, createElement(ChevronDown, { width: 14, height: 14 }));

const vaultBtn = document.createElement("button");
vaultBtn.type = "button";
vaultBtn.id = "caseVaultToggle";
vaultBtn.className = "case-workbench-bar__vault-btn";
vaultBtn.title = "Open floating Rigging Portal armature gallery";
vaultBtn.append(createElement(Users, { width: 13, height: 13 }), document.createTextNode("Rigging Vault"));

const runtime = document.createElement("div");
runtime.className = "case-workbench-bar__runtime";
runtime.innerHTML = `
  <span class="case-workbench-bar__state">Local</span>
  <span>${currentCase?.renderer || "dom"}</span>
`;

bar.append(launcherLink, identity, routePicker, vaultBtn, runtime);
document.body.prepend(bar);

// Floating cross-case Rigging Portal Armature Gallery drawer
const vaultDrawer = document.createElement("aside");
vaultDrawer.id = "caseVaultDrawer";
vaultDrawer.className = "case-vault-drawer";
vaultDrawer.hidden = true;
vaultDrawer.setAttribute("aria-label", "Rigging Portal Verified Armatures");
vaultDrawer.innerHTML = `
  <div class="case-vault-drawer__head">
    <div>
      <span>Rigging Portal · Verified Armatures</span>
      <strong id="caseVaultCount">Loading…</strong>
    </div>
    <button type="button" class="case-vault-drawer__close" id="caseVaultClose" aria-label="Close vault"></button>
  </div>
  <div class="case-vault-drawer__controls">
    <input id="caseVaultSearch" class="case-vault-drawer__search" type="search" placeholder="Filter by id, name, MIA…" />
    <a href="/gallery.html" class="case-vault-drawer__link">Full Page</a>
  </div>
  <div class="case-vault-drawer__list" id="caseVaultList"></div>
`;
document.body.appendChild(vaultDrawer);
document.getElementById("caseVaultClose")?.appendChild(createElement(X, { width: 14, height: 14 }));

let vaultCharacters: RiggingPortalCharacter[] = [];
let vaultLoaded = false;

function renderVaultList(filter = "") {
  const listEl = document.getElementById("caseVaultList");
  const countEl = document.getElementById("caseVaultCount");
  if (!listEl) return;

  const q = filter.trim().toLowerCase();
  const visible = q
    ? vaultCharacters.filter(
        (c) => c.id.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q),
      )
    : vaultCharacters;

  if (countEl) {
    countEl.textContent = `${visible.length} armature${visible.length === 1 ? "" : "s"}`;
  }

  if (visible.length === 0) {
    listEl.innerHTML = `<p class="case-vault-drawer__empty">No verified armatures found. Check Rigging Portal (:5188).</p>`;
    return;
  }

  listEl.innerHTML = visible
    .map(
      (c) => `
      <div class="case-vault-card" data-vault-id="${c.id}">
        <div class="case-vault-card__meta">
          <strong>${c.displayName}</strong>
          <span>${c.id} · ${c.sourceType} · ${c.motionsCount}m${c.retargetTargetId ? " · M2MR" : ""}</span>
        </div>
        <div class="case-vault-card__actions">
          <button type="button" class="case-vault-card__btn is-primary" data-vault-select="${c.id}">Use</button>
          <a class="case-vault-card__btn" href="/mocap-lab.html?avatar=${encodeURIComponent(c.id)}">Mocap</a>
        </div>
      </div>
    `,
    )
    .join("");
}

async function openVaultDrawer() {
  vaultDrawer.hidden = !vaultDrawer.hidden;
  vaultBtn.classList.toggle("is-active", !vaultDrawer.hidden);
  if (!vaultDrawer.hidden && !vaultLoaded) {
    vaultLoaded = true;
    const { online, characters } = await fetchRiggingPortalCharacters();
    vaultCharacters = characters;
    const countEl = document.getElementById("caseVaultCount");
    if (!online && countEl) countEl.textContent = "Rigging Portal (:5188) offline";
    renderVaultList((document.getElementById("caseVaultSearch") as HTMLInputElement | null)?.value || "");
  }
}

vaultBtn.addEventListener("click", () => {
  void openVaultDrawer();
});

document.getElementById("caseVaultClose")?.addEventListener("click", () => {
  vaultDrawer.hidden = true;
  vaultBtn.classList.remove("is-active");
});

document.getElementById("caseVaultSearch")?.addEventListener("input", (event) => {
  renderVaultList((event.target as HTMLInputElement).value);
});

document.getElementById("caseVaultList")?.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-vault-select]");
  if (!btn) return;
  const char = vaultCharacters.find((c) => c.id === btn.dataset.vaultSelect);
  if (!char) return;
  saveSelectedRiggingCharacter(char);
  vaultDrawer.hidden = true;
  vaultBtn.classList.remove("is-active");
  if (currentCase?.id !== "mocap-lab" && currentGallery?.href !== "/gallery.html") {
    window.location.assign(`/mocap-lab.html?avatar=${encodeURIComponent(char.id)}`);
  }
});

if (currentCase?.id === "composition-layer" && window.matchMedia("(max-width: 700px)").matches) {
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".panel"));
  panels.forEach((panel) => panel.classList.add("minimized"));
  panels.forEach((panel) => {
    panel.addEventListener("click", () => {
      if (!panel.classList.contains("minimized")) {
        panels.filter((candidate) => candidate !== panel).forEach((candidate) => {
          candidate.classList.add("minimized");
        });
      }
    });
  });
}

document.documentElement.dataset.avatarLabsCaseShell = "ready";
