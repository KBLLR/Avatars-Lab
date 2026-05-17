"""
head-bakery / bake_head.py
==========================

One Python entrypoint that turns a ChatAvatar `.zip` source pack into a single
canonical `<head_id>.glb` ready for the new `avatar-loader.ts` runtime.

Design contract (locked with David, 2026-05-08):
  * 7 canonical material slots:
      face, backhead, eyes, eyelashes, teeth, mouth_interior, occlusion_hidden
  * Pre-multiplied diffuse with AO + SSS baked in
      (eliminates the runtime aoMap + uv2 dependency)
  * 51 ARKit blendshapes named camelCase: eyeBlinkLeft, jawOpen, mouthFunnel, ...
  * Single mesh (model body + accessory components merged where useful)
  * Embedded textures (no external `/maps/` lookups at runtime)
  * Head bbox normalized to runtime camera target (~0.6 m)
  * Output: warehouse/var/cache/objects/avatar-labs/head-bakery-<DATE>/<id>/<id>.glb

The bakery also writes a per-head provenance JSON so the warehouse knows what
went in and what came out.

This script must be EXECUTED INSIDE BLENDER. Driven via Blender MCP from
`/Users/davidcaballero/core-x-kbllr_0/houses/avatar-labs/scripts/head-bakery/bake_head.py`.

Usage from Blender Python (or via mcp__blender__execute_blender_code):

    import sys
    sys.path.insert(
        0,
        "/Users/davidcaballero/core-x-kbllr_0/houses/avatar-labs/scripts/head-bakery",
    )
    import bake_head
    bake_head.run(zip_path="/Users/davidcaballero/core-x-kbllr_0/core-x/design/kbllr.zip",
                  head_id="kbllr",
                  warehouse_run="head-bakery-2026-05-08")
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# These imports only resolve inside Blender's embedded Python.
import bpy  # type: ignore
import mathutils  # type: ignore  # provided by Blender
from ChatAvatarImportTool.ChatAvatarPack.defs import (  # type: ignore
    AdditionalElements,
    Topology,
    TextureResolution,
)


# ── Constants ────────────────────────────────────────────────────────────────

WAREHOUSE_ROOT = Path(
    "/Users/davidcaballero/core-x-kbllr_0/warehouse/var/cache/objects/avatar-labs"
)

# The 7 canonical material names that the new runtime understands.
CANONICAL_MATERIAL_NAMES = (
    "face",
    "backhead",
    "eyes",
    "eyelashes",
    "teeth",
    "mouth_interior",
    "occlusion_hidden",
)

# How ChatAvatar's source-pack material names map onto our canonical 7.
# The right-hand side must be one of CANONICAL_MATERIAL_NAMES.
#
# Two name conventions exist in the wild:
#   • Body / addon-library name:  Face, Backhead, Eye, Eyelashes, Teeth,
#                                 Fluid, TeethFluid, Occlusion
#   • Component-FBX slot name:    M_Face, M_BackHead, M_EyeLashes,
#                                 left_eyeball, right_eyeball, teeth,
#                                 teeth_fluid, Occ, Fluid
# Plus Blender's `.NNN` duplicate-suffix when both conventions live in the
# same scene (e.g. `M_EyeLashes.014`). The lookup helper below strips that
# suffix before consulting the table.
SOURCE_TO_CANONICAL = {
    # body / library
    "Face": "face",
    "Backhead": "backhead",
    "Eye": "eyes",
    "Eyelashes": "eyelashes",
    "Teeth": "teeth",
    "Fluid": "mouth_interior",
    "TeethFluid": "mouth_interior",
    "Occlusion": "occlusion_hidden",
    # component-FBX slot names
    "M_Face": "face",
    "M_BackHead": "backhead",
    "M_EyeLashes": "eyelashes",
    "left_eyeball": "eyes",
    "right_eyeball": "eyes",
    "teeth": "teeth",
    "teeth_fluid": "mouth_interior",
    "Occ": "occlusion_hidden",
}


def _strip_blender_suffix(name: str) -> str:
    """Remove Blender's `.NNN` duplicate suffix (`M_EyeLashes.014` → `M_EyeLashes`)."""
    import re
    return re.sub(r"\.\d+$", "", name)


def canonical_for(source_name: str) -> Optional[str]:
    """Return the canonical material name for a source-pack slot name, or
    None if the slot doesn't map to any of the seven canonical roles."""
    return SOURCE_TO_CANONICAL.get(_strip_blender_suffix(source_name))

# 51 ARKit blendshape names in canonical camelCase.
# These are the names ChatAvatar's `additional_blendshape.fbx` already uses
# (verified: Blender import logged "Added EyeBlinkLeft", "Added JawOpen", etc.).
# We just normalise the first character to lowercase to match Apple's spec
# (ARKit uses `eyeBlinkLeft` not `EyeBlinkLeft`).
ARKIT_BLENDSHAPES_CAMEL = (
    "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft",
    "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
    "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight",
    "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
    "jawForward", "jawRight", "jawLeft", "jawOpen",
    "mouthClose", "mouthFunnel", "mouthPucker", "mouthRight", "mouthLeft",
    "mouthSmileLeft", "mouthSmileRight",
    "mouthFrownLeft", "mouthFrownRight",
    "mouthDimpleLeft", "mouthDimpleRight",
    "mouthStretchLeft", "mouthStretchRight",
    "mouthRollLower", "mouthRollUpper",
    "mouthShrugLower", "mouthShrugUpper",
    "mouthPressLeft", "mouthPressRight",
    "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "browDownLeft", "browDownRight", "browInnerUp",
    "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "noseSneerLeft", "noseSneerRight",
    "tongueOut",
)

# Head sizing — keep parity with `voice-scene.ts` so the new loader can drop in.
TARGET_HEAD_HEIGHT_M = 0.6   # roughly matches the old MAX_EXPECTED_RADIUS=1.0


# ── Pack discovery ───────────────────────────────────────────────────────────

class PackLayout:
    """Resolves source paths inside an extracted ChatAvatar pack.

    Handles three known shapes encountered in the wild (anja/nyx are clean
    USCBasicPack, eli has OBJ body + missing backhead set, kbllr is split into
    USCBasicPack + USCHighPack)."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.basic = self.root / "USCBasicPack"
        self.high = self.root / "USCHighPack"
        # high-pack overrides basic-pack when both exist
        self.face_dir = self.high if self.high.exists() else self.basic
        self.support_dir = self.basic if self.basic.exists() else self.high

    # — required ——
    def model(self) -> Path:
        for d in (self.face_dir, self.support_dir):
            p = d / "model.obj"
            if p.exists():
                return p
        raise FileNotFoundError(f"model.obj not found under {self.root}")

    def face_diffuse(self) -> Path:
        return self.face_dir / "texture_diffuse.png"

    def face_normal(self) -> Path:
        return self.face_dir / "texture_normal.png"

    def face_specular(self) -> Path:
        return self.face_dir / "texture_specular.png"

    # — optional ——
    def backhead_diffuse(self) -> Optional[Path]:
        for cand in (
            self.support_dir / "texture_diffuse_backhead.png",
            self.support_dir / "texture_diffuse_USCBasicPack.png",
        ):
            if cand.exists():
                return cand
        return None

    def backhead_normal(self) -> Optional[Path]:
        p = self.support_dir / "texture_normal_backhead.png"
        return p if p.exists() else None

    def backhead_specular(self) -> Optional[Path]:
        p = self.support_dir / "texture_specular_backhead.png"
        return p if p.exists() else None

    def body_mesh(self) -> Optional[Path]:
        for cand in (
            self.support_dir / "additional_body.fbx",
            self.support_dir / "additional_body.obj",
            self.face_dir / "additional_body.fbx",
            self.face_dir / "additional_body.obj",
        ):
            if cand.exists():
                return cand
        return None

    def components(self) -> Optional[Path]:
        for d in (self.support_dir, self.face_dir):
            p = d / "additional_component.fbx"
            if p.exists():
                return p
        return None

    def blendshapes(self) -> Optional[Path]:
        for d in (self.support_dir, self.face_dir):
            p = d / "additional_blendshape.fbx"
            if p.exists():
                return p
        return None

    def has_backhead_set(self) -> bool:
        return all(
            p is not None
            for p in (
                self.backhead_diffuse(),
                self.backhead_normal(),
                self.backhead_specular(),
            )
        )

    def texture_resolution(self) -> int:
        """Use the face diffuse to detect 2K vs 4K source."""
        try:
            sz = self.face_diffuse().stat().st_size
            # rough heuristic: kbllr 4K diffuse is ~12 MB, 2K packs are ~2.5 MB
            return 4096 if sz > 6_000_000 else 2048
        except FileNotFoundError:
            return 2048


# ── Scene management ─────────────────────────────────────────────────────────

def clear_scene() -> None:
    """Wipe meshes / materials / images while preserving the 3D viewport
    context that ``bpy.ops.wm.obj_import`` requires (read_homefile breaks
    that context)."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img, do_unlink=True)


# ── ChatAvatar import ─────────────────────────────────────────────────────────

def import_chatavatar(layout: PackLayout, head_id: str) -> bpy.types.Object:
    """Run the ChatAvatar addon importer with the right enum keys."""
    texture_paths = {
        "texture_diffuse": str(layout.face_diffuse()),
        "texture_normal": str(layout.face_normal()),
        "texture_specular": str(layout.face_specular()),
    }
    additional_paths: dict[str, object] = {}
    selected = 0

    body = layout.body_mesh()
    if body is not None:
        additional_paths[str(AdditionalElements.RiggedBody.value)] = str(body)
        selected |= AdditionalElements.RiggedBody.value

    comp = layout.components()
    if comp is not None:
        additional_paths[str(AdditionalElements.Components.value)] = str(comp)
        selected |= AdditionalElements.Components.value

    bs = layout.blendshapes()
    if bs is not None:
        additional_paths[str(AdditionalElements.BlendShapes.value)] = str(bs)
        selected |= AdditionalElements.BlendShapes.value

    if layout.has_backhead_set():
        additional_paths[str(AdditionalElements.BackHeadTex.value)] = {
            "texture_diffuse": str(layout.backhead_diffuse()),
            "texture_normal": str(layout.backhead_normal()),
            "texture_specular": str(layout.backhead_specular()),
        }
        selected |= AdditionalElements.BackHeadTex.value

    bpy.ops.chatavatar.import_package(
        model_path=str(layout.model()),
        obj_name=head_id,
        texture_paths=json.dumps(texture_paths),
        additional_paths=json.dumps(additional_paths),
        pack_name="USCBasicPack",  # cosmetic; addon uses it for naming only
        selected_pack_resolution=TextureResolution.TwoK.value,
        selected_pack_topology=Topology.Default.value,
        selected_additional=selected,
        available_additional=selected,
    )

    # The addon imports model.obj as a mesh named "model". Find it.
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name in {"model", head_id}:
            return o
    # fallback: any mesh
    for o in bpy.data.objects:
        if o.type == "MESH":
            return o
    raise RuntimeError("import_chatavatar: no mesh found post-import")


# ── Material rename pass ─────────────────────────────────────────────────────

def _is_obj_leftover_material(mat: bpy.types.Material) -> bool:
    """OBJ import creates default materials named e.g. `face`, `back`, `face.001`
    that conflict with our canonical rename pass. Detect them by absence of any
    image-texture nodes (real ChatAvatar materials always carry images)."""
    if mat is None or mat.node_tree is None:
        return True
    has_image = any(
        getattr(n, "image", None) is not None
        for n in mat.node_tree.nodes
        if n.type == "TEX_IMAGE"
    )
    return not has_image


def rename_materials_to_canonical(obj: bpy.types.Object) -> dict[str, str]:
    """Rename slot materials to the canonical 7. Returns {old: new} map.

    Pre-step: delete any OBJ-leftover material whose name collides with one of
    our canonical targets (`face`, `back`, `back.001`, etc.). Without this the
    rename `Face → face` actually becomes `face.001` because Blender refuses to
    duplicate names, which then makes the bake loop skip the renamed slot.
    """
    rename_log: dict[str, str] = {}

    # 1. Build the set of canonical target names we're about to claim.
    targets = set(SOURCE_TO_CANONICAL.values())

    # 2. Delete OBJ leftover materials that occupy those names. These hold no
    #    image textures so we lose nothing of value.
    for mat in list(bpy.data.materials):
        if mat.name in targets and _is_obj_leftover_material(mat):
            bpy.data.materials.remove(mat, do_unlink=True)

    # 3. Now run the rename. Blender keeps the canonical name because the
    #    conflicting OBJ leftover is gone.
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None:
            continue
        new = canonical_for(mat.name)
        if new and new != mat.name:
            rename_log[mat.name] = new
            mat.name = new
    return rename_log


# ── Diffuse bake (color-only, no lighting) ───────────────────────────────────

def bake_one_material(
    target_obj: bpy.types.Object,
    mat: bpy.types.Material,
    out_path: Path,
    image_name: str,
    resolution: int = 2048,
) -> bool:
    """Cycles-bake one material's DIFFUSE+COLOR pass on `target_obj` into a
    PNG. Returns True on success.

    The bake captures the full node-group shader output (cornea + iris +
    parallax for eyes; gums + plaque + occlusion for teeth; etc.) into a
    single 2D image that glTF can ship as Base Color. The runtime then
    samples the image with the mesh's UVs and gets the same look the
    Cycles render produced — without needing the custom node graph.
    """
    bpy.ops.object.select_all(action="DESELECT")
    target_obj.select_set(True)
    bpy.context.view_layer.objects.active = target_obj

    bake_img = bpy.data.images.get(image_name) or bpy.data.images.new(
        image_name, resolution, resolution, alpha=True,
    )
    bake_img.filepath_raw = str(out_path)
    bake_img.file_format = "PNG"

    nt = mat.node_tree
    bake_node = nt.nodes.new("ShaderNodeTexImage")
    bake_node.name = "BAKE_TARGET"
    bake_node.image = bake_img
    nt.nodes.active = bake_node
    try:
        bpy.ops.object.bake(
            type="DIFFUSE",
            pass_filter={"COLOR"},
            margin=4,
            use_clear=True,
            uv_layer="UVMap",
        )
        bake_img.save_render(filepath=str(out_path))
        return True
    except Exception as e:
        print(f"  ✗ bake failed for {mat.name}: {str(e)[:200]}")
        return False
    finally:
        nt.nodes.remove(bake_node)


def bake_face_and_backhead(
    obj: bpy.types.Object, head_id: str, out_dir: Path
) -> dict[str, dict]:
    """Bake `face` material's DIFFUSE+COLOR pass into a 2K PNG (the backhead
    uses its source pack texture directly — a 78 KB sparse bake sampled
    wrong on v1)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 8
    sc.cycles.bake_type = "DIFFUSE"
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True

    out_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}

    for slot in obj.material_slots:
        mat = slot.material
        if mat is None or mat.name != "face":
            continue
        out_path = out_dir / f"{head_id}_{mat.name}_baked.png"
        ok = bake_one_material(obj, mat, out_path, f"{head_id}_{mat.name}_baked")
        results[mat.name] = (
            {"ok": True, "path": str(out_path), "size_bytes": out_path.stat().st_size}
            if ok else {"ok": False}
        )
    return results


# ── Per-component-material bakes ─────────────────────────────────────────────

# These materials live on the components mesh, not on the body OBJ, so the
# bake target object is different from `bake_face_and_backhead`'s. The full
# Cycles output of each material — cornea + iris + sclera + parallax for
# eyes; gum + plaque + occlusion + SSS for teeth; lash strand + alpha for
# eyelashes — gets compressed into a single 2D PNG that glTF can ship as a
# baseColorTexture, so the runtime sees these without needing the original
# custom node groups.
COMPONENT_BAKE_ROLES = ("eyes", "eyelashes", "teeth", "mouth_interior")


def bake_components_canonical_materials(
    component_meshes: list[bpy.types.Object],
    head_id: str,
    out_dir: Path,
) -> dict[str, dict]:
    """Cycles-bake every visible canonical material on the component mesh
    (eyes, eyelashes, teeth, mouth_interior) to its own PNG.

    `occlusion_hidden` is intentionally NOT baked — its only job is to be
    invisible at runtime. `face` / `backhead` are baked on the body OBJ
    earlier in the pipeline.
    """
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 8
    sc.cycles.bake_type = "DIFFUSE"
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True

    out_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}

    for cm in component_meshes:
        for slot in cm.material_slots:
            mat = slot.material
            if mat is None:
                continue
            if mat.name not in COMPONENT_BAKE_ROLES:
                continue
            if mat.name in results:
                continue  # already baked once (e.g. multiple eyelash slots)
            out_path = out_dir / f"{head_id}_{mat.name}_baked.png"
            ok = bake_one_material(cm, mat, out_path, f"{head_id}_{mat.name}_baked")
            results[mat.name] = (
                {"ok": True, "path": str(out_path),
                 "size_bytes": out_path.stat().st_size}
                if ok else {"ok": False}
            )
    return results


# ── Wire baked images back into materials ────────────────────────────────────

def flatten_skin_material_to_principled(
    mat: bpy.types.Material,
    baked_diffuse: bpy.types.Image,
    normal: Optional[bpy.types.Image],
    specular: Optional[bpy.types.Image],
) -> None:
    """Replace ChatAvatar's custom skin/SSS shader graph with a Principled
    BSDF setup that mirrors the canonical ChatAvatar example.blend wiring
    (and that glTF can actually export):

        TEX_IMAGE(diffuse, sRGB)   → Base Color
        TEX_IMAGE(normal, Linear)  → NormalMap → Normal
        TEX_IMAGE(specular, Linear)→ Specular IOR Level   (NOT roughness)
        roughness = 0.5            (constant — canonical)
        coat = 0.15, coat roughness = 0.1   (subtle skin sheen)
        IOR = 1.45

    The Cycles bake we ran earlier (DIFFUSE + use_pass_color) already
    premultiplied subsurface-scattering and AO into the diffuse PNG, so we
    deliberately do NOT add SSS back into the runtime graph — that would
    double-scatter the skin and over-soften it. glTF doesn't ship SSS in
    standard PBR-MR anyway.
    """
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    out_node.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    # Base color (premultiplied AO+SSS from the Cycles bake)
    diff_node = nt.nodes.new("ShaderNodeTexImage")
    diff_node.image = baked_diffuse
    diff_node.image.colorspace_settings.name = "sRGB"
    diff_node.location = (-400, 200)
    nt.links.new(diff_node.outputs["Color"], bsdf.inputs["Base Color"])

    # Normal map
    if normal is not None:
        n_img = nt.nodes.new("ShaderNodeTexImage")
        n_img.image = normal
        n_img.image.colorspace_settings.name = "Non-Color"
        n_img.location = (-400, -100)
        n_map = nt.nodes.new("ShaderNodeNormalMap")
        n_map.location = (-100, -100)
        nt.links.new(n_img.outputs["Color"], n_map.inputs["Color"])
        nt.links.new(n_map.outputs["Normal"], bsdf.inputs["Normal"])

    # Specular intensity — this is the canonical wiring (ChatAvatar drives
    # `Specular IOR Level` from the spec map). We feed the same value into
    # the runtime's Three.js `specularIntensityMap` via glTF's
    # `KHR_materials_specular`.
    if specular is not None:
        s_img = nt.nodes.new("ShaderNodeTexImage")
        s_img.image = specular
        s_img.image.colorspace_settings.name = "Non-Color"
        s_img.location = (-400, -400)
        # Principled in Blender 4+ uses "Specular IOR Level" socket name.
        target_socket = (
            bsdf.inputs.get("Specular IOR Level")
            or bsdf.inputs.get("Specular")  # legacy
        )
        if target_socket is not None:
            nt.links.new(s_img.outputs["Color"], target_socket)

    # Canonical skin defaults
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.5
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.45
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.15
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.1


def replace_material_diffuse_with_bake(
    obj: bpy.types.Object, bakes: dict[str, dict], layout: PackLayout
) -> None:
    """Flatten the body's `face` and `backhead` materials to clean
    Principled-BSDF graphs that glTF can export.

    `face` uses the Cycles-baked diffuse (premultiplied AO+SSS).
    `backhead` uses the source pack's `texture_diffuse_backhead.png` directly
        — the bake produced a sparse 78 KB image that sampled wrong on
        kbllr v1, while the source is a complete 1.2 MB texture that the
        body's UVs are already designed for.
    """
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None or mat.name not in {"face", "backhead"}:
            continue

        if mat.name == "face":
            bake = bakes.get("face")
            if not bake or not bake.get("ok"):
                continue
            base_color_img = bpy.data.images.load(bake["path"], check_existing=True)
            normal_path = layout.face_normal()
            specular_path = layout.face_specular()
        else:  # backhead — skip the bake, use source pack texture directly
            bh_diff = layout.backhead_diffuse()
            if bh_diff is None or not Path(bh_diff).exists():
                # No backhead source available (e.g. eli pack) — nothing to do.
                continue
            base_color_img = bpy.data.images.load(str(bh_diff), check_existing=True)
            normal_path = layout.backhead_normal()
            specular_path = layout.backhead_specular()

        normal_img = (
            bpy.data.images.load(str(normal_path), check_existing=True)
            if normal_path and Path(normal_path).exists()
            else None
        )
        specular_img = (
            bpy.data.images.load(str(specular_path), check_existing=True)
            if specular_path and Path(specular_path).exists()
            else None
        )
        flatten_skin_material_to_principled(mat, base_color_img, normal_img, specular_img)


# ── Component import (eyes / teeth / eyelashes / fluid / occlusion) ─────────
#
# ChatAvatar's `additional_component.fbx` is misleadingly named — it actually
# contains ONE mesh ("blendshapes_with_components") that holds the full head
# topology with the components AND duplicates of face/backhead. If we import
# it and parent it under the body model, the duplicate face/backhead slots
# overlap and z-fight, plus the bundled occlusion shell ends up drawing in
# front of the body. So the bakery only keeps the *additional* canonical
# roles (eyes, eyelashes, teeth, mouth_interior, occlusion_hidden) and
# discards face/backhead from this import — they already live on the body.

ROLES_FROM_COMPONENTS = {
    "eyes",
    "eyelashes",
    "teeth",
    "mouth_interior",
    "occlusion_hidden",
}


def import_component_meshes(layout: PackLayout, parent: bpy.types.Object) -> list[bpy.types.Object]:
    """Import additional_component.fbx; align it to the body, then parent every
    imported mesh under the head body so they all export as a single GLB.

    The FBX components are authored in a head-at-origin coordinate frame but
    the FBX import path leaves their object-level transform on the meshes
    (and any child armature). If we just `parent =` the body without baking
    those transforms into vertices, the components end up offset on the neck
    once the parent's normalize-size scale propagates through.

    Fix: apply rotation+scale to the imported meshes (baking the FBX axis
    conversion into local vertex coordinates), set their object transform to
    identity, *then* parent. After this they share the body's local frame.
    """
    comp = layout.components()
    if comp is None or not comp.exists():
        return []
    pre = set(bpy.data.objects.keys())
    bpy.ops.import_scene.fbx(filepath=str(comp))
    new = [o for o in bpy.data.objects if o.name not in pre]

    meshes = [o for o in new if o.type == "MESH"]
    armatures = [o for o in new if o.type == "ARMATURE"]

    # Align: bake the FBX-import transforms into vertex data so the imported
    # meshes share the body's identity-transform local frame.
    for m in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = m
        m.select_set(True)
        # Apply rotation + scale (location stays so we can re-zero below).
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        # Drop any leftover object-level translation: the components are now
        # in head-at-origin coordinates, matching model.obj.
        m.location = (0.0, 0.0, 0.0)

    # Now parent (use without_inverse so children keep their world transform
    # but their local transform is the body's local frame).
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = parent
    parent.select_set(True)
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=False)

    # Ditch the leftover armatures from the FBX — we don't drive bones on the
    # head, only morph targets and SAID-driven blendshapes.
    for a in armatures:
        bpy.data.objects.remove(a, do_unlink=True)

    print(f"[bake_head] imported {len(meshes)} component meshes from {comp.name}, "
          f"discarded {len(armatures)} armature(s)")
    for m in meshes:
        slots = [s.material.name if s.material else "<none>" for s in m.material_slots]
        print(f"  • {m.name}  slots={slots[:8]}{'…' if len(slots)>8 else ''}")
    return meshes


def fix_eye_normals(component_meshes: list[bpy.types.Object]) -> int:
    """ChatAvatar's eye geometry imports with inward-facing normals because
    the FBX represents an "outer cornea + inner iris" two-surface ball; with
    Three.js DoubleSide rendering, the outer (white) surface ends up covering
    the colored iris from the camera's POV. Flip the normals on every face
    using the `eyes` material so FrontSide culling — which we'll re-enable
    in the runtime — keeps the iris visible.

    Returns the number of faces flipped.
    """
    import bmesh
    flipped = 0
    for m in component_meshes:
        eye_slot_indices = {
            i for i, slot in enumerate(m.material_slots)
            if slot.material is not None and slot.material.name == "eyes"
        }
        if not eye_slot_indices:
            continue
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(m.data)
        bm.faces.ensure_lookup_table()
        eye_faces = [f for f in bm.faces if f.material_index in eye_slot_indices]
        flipped += len(eye_faces)
        for f in eye_faces:
            f.normal_flip()
        bmesh.update_edit_mesh(m.data)
        bpy.ops.object.mode_set(mode="OBJECT")
    return flipped


def replace_eye_domes_with_spheres(
    component_meshes: list[bpy.types.Object],
    head_parent: bpy.types.Object,
) -> dict:
    """Replace each ChatAvatar "eye" patch with a proper UV-sphere eyeball.

    Why: ChatAvatar ships eyes as a ~800-poly DOME (the visible portion of the
    eyeball, viewed through the eyelid opening), not a full sphere. The
    Eye_Diffuse1.png texture in the addon library is designed for a full
    spherical eye with iris at the centre. When we tried to UV-remap the dome
    to fit the sphere texture, the iris ended up at one corner of the visible
    patch (user screenshots showed this — "tiny iris floating in vast white
    sclera").

    Real fix: keep the dome geometry (it carries any shape keys for eye-blink
    deltas) but **hide it** by re-assigning to the occlusion_hidden role.
    Then add a real UV sphere child of the head mesh at the same centroid
    with the canonical "eyes" material so the sphere shows through the
    eyelid opening with correct iris orientation.

    Returns a stats dict for provenance.
    """
    import bmesh
    stats: dict = {"eyes_processed": 0, "spheres_created": [], "domes_hidden": []}

    # Ensure the canonical materials exist (eyes + occlusion_hidden may have
    # been created earlier in the bake; we just look them up).
    eye_mat = bpy.data.materials.get("eyes")
    if eye_mat is None:
        eye_mat = bpy.data.materials.new("eyes")
        eye_mat.use_nodes = True
    occ_mat = bpy.data.materials.get("occlusion_hidden")
    if occ_mat is None:
        occ_mat = bpy.data.materials.new("occlusion_hidden")
        occ_mat.use_nodes = True

    for cm in component_meshes:
        # Find every slot that holds the "eyes" material. There are typically
        # two — left + right — each as a distinct slot.
        eye_slot_indices = [
            i for i, slot in enumerate(cm.material_slots)
            if slot.material is not None and slot.material.name == "eyes"
        ]
        # Find / add a slot for occlusion_hidden so we can reassign to it.
        occ_slot_idx = next(
            (i for i, slot in enumerate(cm.material_slots)
             if slot.material is not None and slot.material.name == "occlusion_hidden"),
            None,
        )
        if occ_slot_idx is None:
            cm.data.materials.append(occ_mat)
            occ_slot_idx = len(cm.material_slots) - 1

        for slot_idx in eye_slot_indices:
            # 1. Compute dome centroid + radius from the eye faces.
            polys = [p for p in cm.data.polygons if p.material_index == slot_idx]
            if not polys:
                continue
            verts_in_dome = set()
            for p in polys:
                verts_in_dome.update(p.vertices)
            if not verts_in_dome:
                continue
            centroid = mathutils.Vector((0.0, 0.0, 0.0))
            for vi in verts_in_dome:
                centroid += cm.data.vertices[vi].co
            centroid /= len(verts_in_dome)
            mean_r = sum(
                (cm.data.vertices[vi].co - centroid).length for vi in verts_in_dome
            ) / len(verts_in_dome)
            # Sphere slightly SMALLER than dome so it tucks cleanly behind
            # the eyelid rim. 1.05× bulged through the lid (user-reported
            # "eyeballs coming out of the lids"). 0.92× ≈ 1.15 leaves enough
            # margin that the lid covers the rim from any viewing angle
            # while still spanning the visible aperture.
            sphere_r = mean_r * 0.92

            # 2. Reassign every dome face to the occlusion_hidden slot so the
            # dome disappears at render time but its vertices remain (any
            # shape-key deltas keyed onto those verts are preserved).
            for p in polys:
                p.material_index = occ_slot_idx

            # 3. Create an ICOSPHERE primitive (no pole singularity — UV
            #    sphere had degenerate vertex fans at ±Z that pinched the
            #    iris under smooth shading). Subdivision 4 → 1280 evenly
            #    distributed faces.
            bpy.ops.mesh.primitive_ico_sphere_add(
                subdivisions=4,
                radius=sphere_r,
                location=tuple(centroid),
            )
            sphere = bpy.context.active_object
            # Orthographic UV projection from the head's forward (-Y in
            # Blender). This treats Eye_Diffuse1 as a flat decal stamped
            # on the front of the eyeball — the texture's iris (a small
            # disc in the center) maps directly to the front-pole area of
            # the sphere.
            #
            # The previous azimuthal-equidistant projection mapped the
            # whole 0..180° latitude to UV radius 0..0.5. Result: the
            # visible eye cap (only ~25° from forward, narrow) covered
            # UV radius only ~0.07, which fit ENTIRELY inside the texture's
            # iris region (radius ~0.15). User saw "iris is huge".
            #
            # Orthographic projection: u = 0.5 + nx/2, v = 0.5 + nz/2.
            # Iris at UV radius 0.15 → sphere position sqrt(nx²+nz²)=0.30
            # → angular radius arcsin(0.30) ≈ 17.5° from forward. Realistic.
            # Back hemisphere maps to same UV as front (invisible behind
            # the eyelid skin anyway — DoubleSide is fine).
            if not sphere.data.uv_layers:
                sphere.data.uv_layers.new(name="UVMap")
            uv_layer = sphere.data.uv_layers.active.data
            for poly in sphere.data.polygons:
                for vi, loop_idx in zip(poly.vertices, poly.loop_indices):
                    co = sphere.data.vertices[vi].co
                    length = math.sqrt(co.x * co.x + co.y * co.y + co.z * co.z)
                    if length < 1e-9:
                        uv_layer[loop_idx].uv = (0.5, 0.5)
                        continue
                    nx = co.x / length
                    nz = co.z / length
                    # Orthographic: just project XZ. Forward = (0, -1, 0) →
                    # (nx, nz) = (0, 0) → UV (0.5, 0.5) = iris center.
                    u = 0.5 + nx * 0.5
                    v = 0.5 + nz * 0.5
                    # Clamp to valid texture range (avoid sub-pixel edge bleed).
                    u = max(0.001, min(0.999, u))
                    v = max(0.001, min(0.999, v))
                    uv_layer[loop_idx].uv = (u, v)
            side = "left" if centroid.x < 0 else "right"
            sphere.name = f"eyeball_{side}"

            # ── No rotation needed ─────────────────────────────────────────
            # The manual UV computation above already places UV (0.5, 0.5) on
            # the vertex at local -Y (Blender forward). After yup export,
            # Blender -Y → glTF +Z, which is exactly where Three.js
            # Object3D.lookAt aims a Mesh's local +Z. So the static
            # orientation already faces the camera; the runtime gaze
            # controller's lookAt deltas just track around that.
            sphere.rotation_euler = (0.0, 0.0, 0.0)

            # Smooth shading — UV sphere primitive defaults to flat per-face
            # shading and the segmentation was visible at close range
            # (user-reported polygon facets). Smooth shading interpolates
            # vertex normals across faces.
            for poly in sphere.data.polygons:
                poly.use_smooth = True

            # Attach the canonical "eyes" material as the sole slot.
            sphere.data.materials.clear()
            sphere.data.materials.append(eye_mat)
            # Tag for the runtime gaze controller.
            sphere["iris_forward_axis"] = "nz_gltf"  # local -Z (post-export) is iris-forward
            sphere["eye_side"] = side
            # Parent to head subtree so export selection picks it up.
            sphere.parent = head_parent
            # Apply the rotation transform now so the exported geometry has
            # the iris baked into the right location AND the mesh's local
            # frame (used by lookAt at runtime) starts identity-aligned.
            # That way subsequent runtime rotations are pure look-at deltas.
            bpy.ops.object.select_all(action="DESELECT")
            bpy.context.view_layer.objects.active = sphere
            sphere.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

            stats["spheres_created"].append({
                "side": side,
                "centroid": tuple(round(v, 3) for v in centroid),
                "dome_radius": round(mean_r, 3),
                "sphere_radius": round(sphere_r, 3),
                "dome_polys_hidden": len(polys),
            })
            stats["eyes_processed"] += 1

    return stats


def emit_head_top_anchor(head_root: bpy.types.Object, head_id: str) -> dict:
    """Add an empty named `head_top_<head_id>` parented to the head root and
    positioned at the crown of the head (top of the head's bounding box,
    centered in X, Z at the head bbox center). The runtime parents hair-card
    GLBs to this empty so haircuts mount in the right place regardless of
    head shape.

    Returns a stats dict for provenance.
    """
    bpy.context.view_layer.update()
    # Use local-space verts of the head_root mesh.
    if head_root.type != "MESH":
        return {"emitted": False, "reason": "head_root not a mesh"}

    xs = [v.co.x for v in head_root.data.vertices]
    ys = [v.co.y for v in head_root.data.vertices]
    zs = [v.co.z for v in head_root.data.vertices]
    if not xs:
        return {"emitted": False, "reason": "no vertices on head root"}

    # Head bbox in head_root local space.
    crown_local = (
        (min(xs) + max(xs)) / 2,
        (min(ys) + max(ys)) / 2,  # center in Y too — anchor sits inside the skull centroid laterally
        max(zs),                   # top of head (Z is up in Blender)
    )

    name = f"head_top_{head_id}"
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = 0.05
    empty.location = crown_local
    bpy.context.collection.objects.link(empty)
    empty.parent = head_root
    return {
        "emitted": True,
        "name": name,
        "local_position": tuple(round(v, 4) for v in crown_local),
    }


def remap_eye_uvs_stereographic(component_meshes: list[bpy.types.Object]) -> dict:
    """Rewrite UVs on every eye-material face so the iris (texture (0.5, 0.5))
    sits at the FRONT of each eye sphere — the side facing the camera in the
    final glTF. ChatAvatar's source eyes inherit their UV layout from a
    parallax-shader pipeline (the iris appears centered regardless of view
    angle because the shader fakes the look-at-camera trick at render time).
    glTF can't carry that shader, so without a UV rewrite the iris ends up
    fixed to one spot on the sphere — the screenshots showed the iris
    pinned to the upper-left of the eye instead of where the user is looking.

    Algorithm: for each eye sphere, find its centroid. For each vertex on
    eye-material faces, compute the unit direction from centroid to vertex,
    then project to UV space using a centered orthographic disc:

        u = 0.5 + 0.45 * dir.x          (left/right shifts the iris)
        v = 0.5 + 0.45 * dir.z          (up/down shifts the iris)
        front_factor = (-dir.y + 1) / 2 (1.0 at front, 0.0 at back)
        u, v are blended toward (0.5, 0.5) by front_factor

    Front of the head in Blender is -Y (verified: eye centroid y ≈ -8.5 with
    head-min y ≈ -12.7). dir.y == -1 → front pole → UV exactly (0.5, 0.5).

    Returns a per-eye stats dict for provenance.
    """
    import mathutils
    stats = {"eyes_processed": 0, "uvs_rewritten": 0, "spheres": []}

    for m in component_meshes:
        eye_slot_indices = {
            i for i, slot in enumerate(m.material_slots)
            if slot.material is not None and slot.material.name == "eyes"
        }
        if not eye_slot_indices:
            continue

        # Group eye faces by sphere — left vs right eye live on different
        # slots. Each slot is one sphere.
        for slot_idx in eye_slot_indices:
            polys = [p for p in m.data.polygons if p.material_index == slot_idx]
            if not polys:
                continue

            # Centroid of this eye sphere.
            verts_in_eye = set()
            for p in polys:
                verts_in_eye.update(p.vertices)
            if not verts_in_eye:
                continue
            centroid = mathutils.Vector((0.0, 0.0, 0.0))
            for vi in verts_in_eye:
                centroid += m.data.vertices[vi].co
            centroid /= len(verts_in_eye)

            # Compute sphere radius (mean distance from centroid).
            radius = sum(
                (m.data.vertices[vi].co - centroid).length for vi in verts_in_eye
            ) / len(verts_in_eye)
            if radius < 1e-6:
                continue

            uv_layer = m.data.uv_layers.active.data
            uvs_set = 0
            for p in polys:
                for vi, loop_idx in zip(p.vertices, p.loop_indices):
                    pos = m.data.vertices[vi].co
                    d = (pos - centroid)
                    dn = d.normalized()
                    # Front pole: dn.y == -1 → iris at center of texture
                    front_factor = max(0.0, (-dn.y + 1.0) * 0.5)
                    # Orthographic disc projection scaled by 0.45 to keep the
                    # iris (centered at 0.5,0.5) within the textured region.
                    # Blender +X (right of head) → texture +U
                    # Blender +Z (up of head) → texture +V
                    # Multiply by front_factor so the back of the sphere also
                    # converges to (0.5, 0.5) instead of stretching past edges.
                    u = 0.5 + 0.45 * dn.x * front_factor
                    v = 0.5 + 0.45 * dn.z * front_factor
                    uv_layer[loop_idx].uv[0] = u
                    uv_layer[loop_idx].uv[1] = v
                    uvs_set += 1

            stats["spheres"].append({
                "slot": slot_idx,
                "centroid": (round(centroid.x, 3), round(centroid.y, 3), round(centroid.z, 3)),
                "radius": round(radius, 3),
                "polys": len(polys),
                "uvs_rewritten": uvs_set,
            })
            stats["eyes_processed"] += 1
            stats["uvs_rewritten"] += uvs_set

    return stats


def strip_eye_faces_from_components(component_meshes: list[bpy.types.Object]) -> int:
    """Delete only the eye-material faces from each components mesh. This
    leaves face/backhead/teeth/lashes/mouth_interior/occlusion_hidden intact —
    critical because every ARKit blendshape (jawOpen, mouthFunnel, …) is
    encoded as a per-vertex delta on the face mesh, and `bmesh.ops.delete`
    re-indexes / drops shape-key data when the underlying vertices go.

    Eyes are stripped because the cornea+iris two-surface geometry renders
    wrong without proper transmissive shading (a v2 problem).
    """
    import bmesh
    deleted = 0
    for m in component_meshes:
        eye_slot_indices = {
            i for i, slot in enumerate(m.material_slots)
            if slot.material is not None and slot.material.name == "eyes"
        }
        if not eye_slot_indices:
            continue
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(m.data)
        bm.faces.ensure_lookup_table()
        eye_faces = [f for f in bm.faces if f.material_index in eye_slot_indices]
        deleted += len(eye_faces)
        bmesh.ops.delete(bm, geom=eye_faces, context="FACES")
        bmesh.update_edit_mesh(m.data)
        bpy.ops.object.mode_set(mode="OBJECT")
    return deleted


def strip_duplicate_face_slots_from_components(
    component_meshes: list[bpy.types.Object],
    extra_roles_to_strip: set[str] = frozenset(),
) -> int:
    """Per-face geometry on the components mesh duplicates the body's face /
    backhead. Hide every face whose slot resolves to a non-component canonical
    role so only the body draws those. Returns count of faces hidden.

    `extra_roles_to_strip` lets the caller also delete faces of valid
    component roles that aren't ready for the current bakery rev (e.g. eyes
    are temporarily stripped because the cornea+iris two-surface ball
    renders wrong without proper transmissive shading)."""
    import bmesh
    hidden = 0
    keep_roles = ROLES_FROM_COMPONENTS - set(extra_roles_to_strip)
    for m in component_meshes:
        # Identify slots whose material name is NOT in keep_roles.
        bad_slot_indices = set()
        for i, slot in enumerate(m.material_slots):
            mat = slot.material
            if mat is None:
                continue
            if mat.name not in keep_roles:
                bad_slot_indices.add(i)
        if not bad_slot_indices:
            continue
        # Enter Edit mode on this mesh, select faces using the bad slots,
        # delete them.
        bpy.context.view_layer.objects.active = m
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(m.data)
        bm.faces.ensure_lookup_table()
        to_delete = [f for f in bm.faces if f.material_index in bad_slot_indices]
        hidden += len(to_delete)
        bmesh.ops.delete(bm, geom=to_delete, context="FACES")
        bmesh.update_edit_mesh(m.data)
        bpy.ops.object.mode_set(mode="OBJECT")
    return hidden


# ── "Let the basics load" — flatten any canonical material to Principled ──

EYE_RESOURCES = Path(__file__).parent / "resources" / "eyes"


def flatten_with_baked_image(
    mat: bpy.types.Material,
    baked: bpy.types.Image,
    *,
    use_alpha: bool = False,
    blend_method: Optional[str] = None,
    fallback_normal: Optional[bpy.types.Image] = None,
) -> None:
    """Replace `mat`'s entire shader graph with a Principled BSDF whose Base
    Color is the baked image. Used by the bakery for eye / teeth /
    mouth_interior — anywhere the canonical material's custom node group
    can't be exported by glTF.

    `use_alpha=True` pipes the baked image's alpha channel into Principled
    Alpha and switches blend_method (eyelashes need this).
    """
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.45

    diff = nt.nodes.new("ShaderNodeTexImage")
    diff.image = baked
    diff.image.colorspace_settings.name = "sRGB"
    diff.location = (-400, 200)
    nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    if use_alpha:
        nt.links.new(diff.outputs["Alpha"], bsdf.inputs["Alpha"])

    if fallback_normal is not None:
        ni = nt.nodes.new("ShaderNodeTexImage")
        ni.image = fallback_normal
        ni.image.colorspace_settings.name = "Non-Color"
        ni.location = (-400, -100)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-100, -100)
        nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if blend_method:
        mat.blend_method = blend_method


def flatten_components_with_bakes(
    bakes: dict[str, dict], component_meshes: list[bpy.types.Object]
) -> None:
    """For each successfully-baked component material, replace its custom
    node-group shader with a clean Principled BSDF that ships the bake as
    Base Color. Keeps the original eyelashes_alpha image wired as Alpha
    via the bake's alpha channel."""
    name_to_mat: dict[str, bpy.types.Material] = {}
    for cm in component_meshes:
        for slot in cm.material_slots:
            if slot.material is not None:
                name_to_mat.setdefault(slot.material.name, slot.material)

    for role, bake in bakes.items():
        if not bake.get("ok"):
            continue
        mat = name_to_mat.get(role)
        if mat is None:
            continue
        baked_img = bpy.data.images.load(bake["path"], check_existing=True)
        if role == "eyelashes":
            # Lashes need alpha; the bake captured the lash silhouette into
            # the PNG's alpha channel via the upstream eyelashes_alpha mask.
            flatten_with_baked_image(mat, baked_img, use_alpha=True, blend_method="HASHED")
        elif role == "mouth_interior":
            # Often partially see-through — keep alpha route.
            flatten_with_baked_image(mat, baked_img, use_alpha=True, blend_method="HASHED")
        else:
            # eyes / teeth — fully opaque diffuse from the bake.
            flatten_with_baked_image(mat, baked_img, use_alpha=False)


# ── Direct-wire (no-bake) library-image flatten for component roles ──────────
#
# The Cycles bake of eye/eyelash/teeth lost most of the visual detail because
# the original ChatAvatar node groups produce iris parallax + cornea bump +
# transmission masks via shader tricks that don't reduce to a single colour.
# Approach instead: rebuild a glTF-friendly Principled BSDF directly from the
# addon library's image textures.
#
# `bpy.data.images.get(...)` returns the addon's pre-loaded copy of each PNG
# (e.g. `Eye_Diffuse1.png`). The image objects already exist after
# `import_chatavatar` runs — we just route them into a clean graph.

def _img(name: str) -> Optional[bpy.types.Image]:
    """Find an image by exact name, or by basename match if `.001` suffixes
    have appeared. Returns None when truly missing."""
    direct = bpy.data.images.get(name)
    if direct is not None:
        return direct
    # Fallback: ChatAvatar imports sometimes append a suffix. Match the stem.
    stem = name.rsplit(".", 1)[0] if "." in name else name
    for img in bpy.data.images:
        if img.name.split(".")[0] == stem and img.size[0] > 0:
            return img
    return None


def _build_lash_basecolor_image(
    src: bpy.types.Image,
    *,
    rgb_tint: tuple[float, float, float] = (0.10, 0.07, 0.04),
    dst_name: str = "eyelashes_basecolor.png",
) -> Optional[bpy.types.Image]:
    """Pre-process the ChatAvatar lash alpha mask into a single RGBA image
    that the glTF exporter can pack cleanly:

      RGB  = constant warm dark (#1a120b by default)
      A    = BLUE channel of `src`, linearly stretched to fill 0..1

    Channel discovery: ChatAvatar's `eyelashes_alpha.png` is RGBA with:
      • R = 1.0 (unused)
      • G = low-contrast gradient (mean 0.22, std 0.02) — looks like an
            SSS/AO bake, NOT the lash mask
      • B = high-contrast bimodal mask (mean 0.98, ~97% bright / ~3% dark)
            — THIS is where the actual strand silhouette lives, BUT in
            painter convention: bright = background, dark = strand
      • A = 1.0 (unused)

    So we read B and INVERT (1 - B), then stretch. Result: strand pixels
    end up at alpha=1.0 (visible) and the surrounding card body ends up
    at alpha=0.0 (cut away by alphaTest at runtime).

    Earlier bakes pulled from G and inverted, which gave the "olive-green
    band" the user reported (G has tiny range and is biased mid). With
    just `B` (no invert) we got an inverted-strand mask: strands cut as
    HOLES in a solid card. The right answer is `1 - B`.
    """
    try:
        import numpy as np  # type: ignore
    except Exception:
        # numpy is bundled with Blender's Python; if it ever isn't, fall
        # back to no-op so the build still produces a (mediocre) lash.
        return None
    if src is None or src.size[0] == 0:
        return None
    w, h = src.size
    px = np.asarray(src.pixels, dtype=np.float32).reshape((-1, 4))
    # BLUE channel holds the strand silhouette in painter convention
    # (bright = background, dark = strand). Invert so strand → 1.0 (alpha
    # opaque), then stretch defensively to fill 0..1.
    mask = 1.0 - px[:, 2]
    lo, hi = float(mask.min()), float(mask.max())
    if hi - lo > 1e-6:
        mask = (mask - lo) / (hi - lo)
    mask = np.clip(mask, 0.0, 1.0)
    out = np.empty_like(px)
    out[:, 0] = float(rgb_tint[0])
    out[:, 1] = float(rgb_tint[1])
    out[:, 2] = float(rgb_tint[2])
    out[:, 3] = mask
    img = bpy.data.images.new(dst_name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels = out.ravel().tolist()
    img.update()
    img.pack()
    return img


def _build_principled(
    mat: bpy.types.Material,
    *,
    base_color: Optional[bpy.types.Image] = None,
    normal: Optional[bpy.types.Image] = None,
    roughness: float = 0.5,
    metallic: float = 0.0,
    alpha: Optional[bpy.types.Image] = None,
    invert_alpha: bool = False,
    base_color_solid: Optional[tuple[float, float, float, float]] = None,
    blend_method: Optional[str] = None,
    alpha_threshold: Optional[float] = None,
    # OPT-IN: wire the base color image's A channel into BSDF.Alpha.
    # Off by default — was auto-on for any RGBA basecolor before, which
    # silently turned the EYE and TEETH materials into alphaMode=BLEND
    # (Eye_Diffuse1 + teeth_color_map_001 are both RGBA with all-1 alpha)
    # → eyes rendered as transparent white planes. Only the lash basecolor
    # genuinely needs this wire because it carries the strand mask in A.
    wire_basecolor_alpha: bool = False,
) -> None:
    """Wipe + rebuild `mat` as Principled BSDF with the given inputs."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (500, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (200, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness

    base_color_node = None
    if base_color is not None:
        bn = nt.nodes.new("ShaderNodeTexImage"); bn.image = base_color
        bn.image.colorspace_settings.name = "sRGB"
        bn.location = (-400, 200)
        nt.links.new(bn.outputs["Color"], bsdf.inputs["Base Color"])
        base_color_node = bn
    elif base_color_solid is not None:
        bsdf.inputs["Base Color"].default_value = base_color_solid

    if normal is not None:
        nn = nt.nodes.new("ShaderNodeTexImage"); nn.image = normal
        nn.image.colorspace_settings.name = "Non-Color"
        nn.location = (-400, -100)
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-100, -100)
        nt.links.new(nn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    if alpha is not None:
        an = nt.nodes.new("ShaderNodeTexImage"); an.image = alpha
        an.image.colorspace_settings.name = "Non-Color"
        an.location = (-400, -400)
        # ChatAvatar packs the lash silhouette into the GREEN channel of
        # eyelashes_alpha.png (UE-style channel packing). Pulling outputs.Color
        # straight into the float Alpha socket would take the R component and
        # produce the olive-green band the user reported. Route through
        # Separate Color and pick G.
        sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-200, -400)
        sep.mode = "RGB"
        nt.links.new(an.outputs["Color"], sep.inputs["Color"])
        if invert_alpha:
            inv = nt.nodes.new("ShaderNodeInvert"); inv.location = (-50, -400)
            nt.links.new(sep.outputs["Green"], inv.inputs["Color"])
            nt.links.new(inv.outputs["Color"], bsdf.inputs["Alpha"])
        else:
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Alpha"])
    elif (
        wire_basecolor_alpha
        and base_color_node is not None
        and base_color is not None
        and base_color.channels >= 4
    ):
        # The base color image carries the alpha mask in its own A channel
        # (e.g. the pre-stretched lash basecolor produced by
        # `_build_lash_basecolor_image`). Wire the texture node's Alpha
        # output straight to BSDF.Alpha so the glTF exporter packs it as
        # the baseColorTexture's alpha channel. OPT-IN only — see the
        # `wire_basecolor_alpha` doc on the function signature.
        nt.links.new(base_color_node.outputs["Alpha"], bsdf.inputs["Alpha"])

    if blend_method:
        # Set blend_method defensively — Blender 4.2+ EEVEE Next renamed the
        # enum, but the property still accepts the legacy values for export
        # compat. Wrap in try so a future rename doesn't kill the bake.
        try:
            mat.blend_method = blend_method
        except Exception as exc:  # noqa: BLE001
            print(f"[bake_head] blend_method='{blend_method}' rejected on '{mat.name}': {exc}")
    if alpha_threshold is not None:
        try:
            mat.alpha_threshold = alpha_threshold
        except Exception as exc:  # noqa: BLE001
            print(f"[bake_head] alpha_threshold rejected on '{mat.name}': {exc}")


def flatten_components_with_library_images(component_meshes: list[bpy.types.Object]) -> dict[str, dict]:
    """Rebuild each canonical component material from the addon-library
    images directly. Works because `import_chatavatar` loaded those images
    into `bpy.data.images` already — we just route them into a glTF-friendly
    Principled graph.

    Per-role mapping:
      eyes            → BaseColor=Eye_Diffuse1, Normal=Cornea_Normal1, gloss/cornea
      eyelashes       → BaseColor=#1a1410, Alpha=eyelashes_alpha (inverted),
                        Normal=eyelashes_normal, HASHED
      teeth           → BaseColor=teeth_color_map_001, Normal=teeth_normal_map
      mouth_interior  → solid dark, slightly rough
      occlusion_hidden→ left untouched here (runtime sets colorWrite=false)
    """
    seen: set[str] = set()
    log: dict[str, dict] = {}
    for cm in component_meshes:
        for slot in cm.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen:
                continue
            seen.add(mat.name)

            if mat.name == "eyes":
                eye_diff = _img("Eye_Diffuse1.png")
                eye_norm = _img("Cornea_Normal1.png")
                _build_principled(
                    mat,
                    base_color=eye_diff,
                    normal=eye_norm,
                    roughness=0.18,
                )
                # Eye is an opaque sphere — clearcoat-y shine added at runtime.
                log[mat.name] = {
                    "base_color": eye_diff.name if eye_diff else None,
                    "normal": eye_norm.name if eye_norm else None,
                }
            elif mat.name == "eyelashes":
                lash_alpha = _img("eyelashes_alpha.png")
                lash_norm = _img("eyelashes_normal.png")
                # Pre-stretch the green-channel mask into a single RGBA
                # base-color image whose alpha channel is the lash silhouette
                # at full 0..1 contrast. This lets the runtime use a clean
                # alphaTest cutoff without needing alphaHash dither.
                lash_basecolor = _build_lash_basecolor_image(
                    lash_alpha,
                    rgb_tint=(0.10, 0.07, 0.04),          # dark warm brown
                ) if lash_alpha is not None else None
                _build_principled(
                    mat,
                    base_color=lash_basecolor,
                    base_color_solid=(0.10, 0.07, 0.04, 1.0)
                        if lash_basecolor is None else None,
                    normal=lash_norm,
                    roughness=0.6,
                    # Lash basecolor's A channel is the strand silhouette —
                    # opt-in to wire it into BSDF.Alpha so glTF packs the
                    # cutout into the texture. Combined with CLIP/MASK below
                    # it renders as crisp strands without dither.
                    wire_basecolor_alpha=True,
                    # CLIP → glTF MASK with alphaCutoff. Blender 5.0 EEVEE
                    # Next removed CLIP from the enum, so we apply it
                    # defensively — _build_principled traps the failure and
                    # the runtime alphaTest=0.5 in avatar-loader.ts is the
                    # backstop.
                    blend_method="CLIP",
                    alpha_threshold=0.5,
                )
                log[mat.name] = {
                    "base_color": (
                        lash_basecolor.name if lash_basecolor else "solid #1a1410"
                    ),
                    "alpha": lash_alpha.name if lash_alpha else None,
                    "normal": lash_norm.name if lash_norm else None,
                    "alpha_stretched": lash_basecolor is not None,
                }
            elif mat.name == "teeth":
                teeth_diff = _img("teeth_color_map_001.png")
                teeth_norm = _img("teeth_normal_map.png")
                _build_principled(
                    mat,
                    base_color=teeth_diff,
                    normal=teeth_norm,
                    roughness=0.35,
                )
                log[mat.name] = {
                    "base_color": teeth_diff.name if teeth_diff else None,
                    "normal": teeth_norm.name if teeth_norm else None,
                }
            elif mat.name == "mouth_interior":
                _build_principled(
                    mat,
                    base_color_solid=(0.05, 0.02, 0.02, 1.0),  # near-black warm
                    roughness=0.8,
                )
                log[mat.name] = {"base_color": "solid dark"}
    return log


def _build_eye_principled(mat: bpy.types.Material) -> None:
    """Build a glTF-friendly Principled-BSDF eye material from the proper
    EyeTeethTex pack (sclera + veins + normal). Three image inputs:

      Base Color → Mix(EyeSclera_D, EyeVeins_D)   [sRGB]
      Normal     → NormalMap(T_Eye_N)              [Linear]

    The runtime `eyes` role config (avatar-loader-v2-bridge) then sets
    glossy clearcoat highlights so the iris area reads as a wet sphere.
    """
    nt = mat.node_tree
    if nt is None:
        return

    sclera_path = EYE_RESOURCES / "T_EyeSclera_D.TGA"
    veins_path = EYE_RESOURCES / "T_EyeVeins_D.TGA"
    normal_path = EYE_RESOURCES / "T_Eye_N.TGA"

    sclera_img = bpy.data.images.load(str(sclera_path), check_existing=True) if sclera_path.exists() else None
    veins_img = bpy.data.images.load(str(veins_path), check_existing=True) if veins_path.exists() else None
    normal_img = bpy.data.images.load(str(normal_path), check_existing=True) if normal_path.exists() else None

    for n in list(nt.nodes):
        nt.nodes.remove(n)

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (200, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.18

    last_color_socket = None
    if sclera_img is not None:
        sn = nt.nodes.new("ShaderNodeTexImage")
        sn.image = sclera_img
        sn.image.colorspace_settings.name = "sRGB"
        sn.location = (-600, 200)
        last_color_socket = sn.outputs["Color"]
    if veins_img is not None:
        vn = nt.nodes.new("ShaderNodeTexImage")
        vn.image = veins_img
        vn.image.colorspace_settings.name = "sRGB"
        vn.location = (-600, -50)
        if last_color_socket is None:
            last_color_socket = vn.outputs["Color"]
        else:
            mix = nt.nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 0.4
            mix.location = (-300, 80)
            nt.links.new(last_color_socket, mix.inputs["Color1"])
            nt.links.new(vn.outputs["Color"], mix.inputs["Color2"])
            last_color_socket = mix.outputs["Color"]
    if last_color_socket is not None:
        nt.links.new(last_color_socket, bsdf.inputs["Base Color"])

    if normal_img is not None:
        nn = nt.nodes.new("ShaderNodeTexImage")
        nn.image = normal_img
        nn.image.colorspace_settings.name = "Non-Color"
        nn.location = (-600, -350)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-300, -350)
        nt.links.new(nn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])


def _build_eyelash_principled(mat: bpy.types.Material) -> None:
    """Eyelashes ship as a black-on-white *mask* image, not a colour diffuse.
    The previous heuristic mistook the mask for a base colour, producing the
    grey/white lash strip the user spotted. The right setup is:

        Base Color  → solid black (lash colour)
        Alpha       → the lash mask image (black = transparent at runtime)

    The runtime's `eyelashes` role then enables alphaHash + DoubleSide so
    the per-strand transparency reads cleanly.
    """
    nt = mat.node_tree
    if nt is None:
        return

    # Find the lash mask image (any non-color image ending in `_alpha`).
    mask_img = None
    for n in nt.nodes:
        if n.type != "TEX_IMAGE" or n.image is None:
            continue
        nm = n.image.name.lower()
        if "lash" in nm and "alpha" in nm:
            mask_img = n.image
            break
    if mask_img is None:
        # fallback: first non-color image we find
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None and n.image.colorspace_settings.name == "Non-Color":
                mask_img = n.image
                break

    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    bsdf.inputs["Base Color"].default_value = (0.02, 0.01, 0.005, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.6

    if mask_img is not None:
        m_node = nt.nodes.new("ShaderNodeTexImage")
        m_node.image = mask_img
        # The ChatAvatar mask uses BLACK = lash, WHITE = empty (inverted).
        # Pipe through a colour-ramp to invert + threshold.
        m_node.image.colorspace_settings.name = "Non-Color"
        m_node.location = (-500, 0)
        inv = nt.nodes.new("ShaderNodeInvert")
        inv.location = (-200, 0)
        nt.links.new(m_node.outputs["Color"], inv.inputs["Color"])
        nt.links.new(inv.outputs["Color"], bsdf.inputs["Alpha"])
    # Alpha blending mode the runtime understands.
    mat.blend_method = "HASHED"


def _principled_from_existing_graph(mat: bpy.types.Material) -> None:
    """For non-skin canonical materials we DON'T re-bake (eyes / teeth /
    fluid / mouth_interior / occlusion_hidden), salvage whatever image
    textures are already wired into the original ChatAvatar shader graph and
    rebuild a Principled-BSDF setup so glTF can export them.

    Strategy: walk the existing graph and pick the most plausible images by
    role hints (sRGB colour vs Non-Color), then wipe and rebuild.

    `eyelashes` and `eyes` are special-cased separately.
    """
    if mat.name == "eyelashes":
        _build_eyelash_principled(mat)
        return
    if mat.name == "eyes":
        _build_eye_principled(mat)
        return

    nt = mat.node_tree
    if nt is None:
        return

    # Gather candidates by colorspace.
    color_imgs = []   # sRGB → likely diffuse / albedo
    data_imgs = []    # Non-Color → likely normal / specular / mask
    for n in nt.nodes:
        if n.type == "TEX_IMAGE" and n.image is not None:
            cs = n.image.colorspace_settings.name
            (color_imgs if cs == "sRGB" else data_imgs).append(n.image)

    base_color = color_imgs[0] if color_imgs else None
    normal_img = None
    rough_img = None
    for img in data_imgs:
        n = img.name.lower()
        if normal_img is None and "normal" in n:
            normal_img = img
        elif rough_img is None and ("specular" in n or "rough" in n):
            rough_img = img
    if normal_img is None and data_imgs:
        normal_img = data_imgs[0]

    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0

    if base_color is not None:
        diff = nt.nodes.new("ShaderNodeTexImage")
        diff.image = base_color
        diff.image.colorspace_settings.name = "sRGB"
        diff.location = (-400, 200)
        nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])

    if normal_img is not None:
        n_img = nt.nodes.new("ShaderNodeTexImage")
        n_img.image = normal_img
        n_img.image.colorspace_settings.name = "Non-Color"
        n_img.location = (-400, -100)
        n_map = nt.nodes.new("ShaderNodeNormalMap")
        n_map.location = (-100, -100)
        nt.links.new(n_img.outputs["Color"], n_map.inputs["Color"])
        nt.links.new(n_map.outputs["Normal"], bsdf.inputs["Normal"])

    if rough_img is not None:
        r_img = nt.nodes.new("ShaderNodeTexImage")
        r_img.image = rough_img
        r_img.image.colorspace_settings.name = "Non-Color"
        r_img.location = (-400, -400)
        inv = nt.nodes.new("ShaderNodeInvert")
        inv.location = (-100, -400)
        nt.links.new(r_img.outputs["Color"], inv.inputs["Color"])
        nt.links.new(inv.outputs["Color"], bsdf.inputs["Roughness"])


def flatten_remaining_canonical_materials(rename_log: dict[str, str]) -> list[str]:
    """For every canonical material that wasn't already rebuilt by the bake
    (face / backhead are handled separately), salvage their existing image
    textures into a fresh Principled graph. Returns names of materials touched.
    """
    touched: list[str] = []
    canonical_names = set(SOURCE_TO_CANONICAL.values()) - {"face", "backhead"}
    for mat in bpy.data.materials:
        if mat.name in canonical_names:
            _principled_from_existing_graph(mat)
            touched.append(mat.name)
    return touched


# ── Blendshape rename pass ───────────────────────────────────────────────────

def normalize_blendshape_names_on_mesh(obj: bpy.types.Object) -> dict[str, str]:
    """Rename PascalCase shape keys to camelCase (ARKit standard) on a single
    mesh."""
    rename_log: dict[str, str] = {}
    if obj.data.shape_keys is None:
        return rename_log
    for kb in obj.data.shape_keys.key_blocks:
        if not kb.name or kb.name == "Basis":
            continue
        camel = kb.name[0].lower() + kb.name[1:] if kb.name[0].isupper() else kb.name
        if camel != kb.name and camel in ARKIT_BLENDSHAPES_CAMEL:
            rename_log[kb.name] = camel
            kb.name = camel
    return rename_log


def normalize_blendshape_names(obj: bpy.types.Object) -> dict[str, str]:
    """Walk obj + all its descendants, rename every shape-key set to ARKit
    camelCase. Returns the merged rename log."""
    log: dict[str, str] = {}
    visited: list[bpy.types.Object] = []
    def visit(o: bpy.types.Object) -> None:
        visited.append(o)
        for c in o.children:
            visit(c)
    visit(obj)
    for o in visited:
        if o.type == "MESH":
            log.update(normalize_blendshape_names_on_mesh(o))
    return log


# ── Size normalization ───────────────────────────────────────────────────────

def normalize_size(obj: bpy.types.Object) -> float:
    """Scale the head so the bbox height ≈ TARGET_HEAD_HEIGHT_M."""
    bpy.context.view_layer.update()
    bbox = obj.bound_box
    ys = [v[1] for v in bbox]
    height = max(ys) - min(ys)
    if height <= 0:
        return 1.0
    factor = TARGET_HEAD_HEIGHT_M / height
    obj.scale = tuple(s * factor for s in obj.scale)
    bpy.context.view_layer.update()
    return factor


# ── GLB export ──────────────────────────────────────────────────────────────

def export_glb(obj: bpy.types.Object, out_path: Path) -> dict:
    """Export the head + parented component meshes to a single GLB with
    embedded textures."""
    out_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="DESELECT")
    # Select the body and every descendant we parented to it (eyes/teeth/lashes).
    def _select_subtree(o: bpy.types.Object) -> None:
        o.select_set(True)
        for child in o.children:
            _select_subtree(child)
    _select_subtree(obj)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",                # binary, single file
        use_selection=True,
        export_apply=True,                  # apply Subdivision modifier
        export_yup=True,
        export_image_format="AUTO",
        export_materials="EXPORT",
        export_morph=True,
        export_morph_normal=True,
        export_morph_tangent=False,
    )
    return {
        "path": str(out_path),
        "size_bytes": out_path.stat().st_size,
    }


# ── Provenance ──────────────────────────────────────────────────────────────

def survey_export_scene(root: bpy.types.Object) -> dict:
    """Walk the head subtree we're about to export and report which materials
    actually own faces on each mesh. This is the ground truth for "does the
    GLB ship eyes?" — eli/nyx had no eye geometry surviving v5 and the only
    way to debug it was to look at slot.material.name + face counts after
    every transformation. Logged into provenance so we can diff bakes.
    """
    survey = {"meshes": [], "materials_with_faces": set()}
    def visit(obj: bpy.types.Object) -> None:
        if obj.type == "MESH":
            face_counts: dict[str, int] = {}
            for face in obj.data.polygons:
                idx = face.material_index
                if idx < len(obj.material_slots):
                    mat = obj.material_slots[idx].material
                    name = mat.name if mat else "<empty>"
                else:
                    name = "<out_of_range>"
                face_counts[name] = face_counts.get(name, 0) + 1
            survey["meshes"].append({
                "name": obj.name,
                "face_count": len(obj.data.polygons),
                "morph_target_count": (
                    len(obj.data.shape_keys.key_blocks) - 1
                    if obj.data.shape_keys else 0
                ),
                "materials": face_counts,
            })
            for n in face_counts:
                survey["materials_with_faces"].add(n)
        for c in obj.children:
            visit(c)
    visit(root)
    survey["materials_with_faces"] = sorted(survey["materials_with_faces"])
    survey["canonical_present"] = [
        n for n in CANONICAL_MATERIAL_NAMES if n in survey["materials_with_faces"]
    ]
    survey["canonical_missing"] = [
        n for n in CANONICAL_MATERIAL_NAMES if n not in survey["materials_with_faces"]
    ]
    return survey


def write_provenance(
    out_dir: Path, head_id: str, source_zip: Path, layout: PackLayout,
    rename_mat: dict[str, str], rename_morph: dict[str, str],
    bakes: dict[str, dict], glb_info: dict, scale_factor: float,
    export_survey: Optional[dict] = None,
) -> Path:
    prov = {
        "head_id": head_id,
        "baked_at": datetime.now(timezone.utc).isoformat(),
        "source_zip": str(source_zip),
        "source_size_bytes": source_zip.stat().st_size,
        "pack_layout": {
            "face_dir": str(layout.face_dir),
            "support_dir": str(layout.support_dir),
            "texture_resolution_detected": layout.texture_resolution(),
            "has_backhead_set": layout.has_backhead_set(),
            "body_mesh": str(layout.body_mesh()) if layout.body_mesh() else None,
            "components": str(layout.components()) if layout.components() else None,
            "blendshapes": str(layout.blendshapes()) if layout.blendshapes() else None,
        },
        "transformations": {
            "material_renames": rename_mat,
            "morph_renames": rename_morph,
            "scale_factor_applied": scale_factor,
        },
        "bakes": bakes,
        "glb": glb_info,
        "canonical_material_names": list(CANONICAL_MATERIAL_NAMES),
        "arkit_blendshapes_expected": list(ARKIT_BLENDSHAPES_CAMEL),
        "export_survey": export_survey,
    }
    p = out_dir / f"{head_id}.provenance.json"
    p.write_text(json.dumps(prov, indent=2))
    return p


# ── Entrypoint ──────────────────────────────────────────────────────────────

def run(
    zip_path: str,
    head_id: str,
    warehouse_run: str = None,
) -> dict:
    """Bake one head from a `.zip` source pack.

    Returns a dict with `out_dir`, `glb_path`, `provenance_path`, `bakes`,
    `material_renames`, `morph_renames`. Raises on hard failure."""
    if warehouse_run is None:
        warehouse_run = f"head-bakery-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    source_zip = Path(zip_path)
    if not source_zip.exists():
        raise FileNotFoundError(zip_path)

    extract_root = Path(tempfile.mkdtemp(prefix=f"head_bakery_{head_id}_"))
    out_dir = WAREHOUSE_ROOT / warehouse_run / head_id

    try:
        with zipfile.ZipFile(source_zip) as zf:
            zf.extractall(extract_root)

        layout = PackLayout(extract_root)
        clear_scene()

        obj = import_chatavatar(layout, head_id)
        rename_mat = rename_materials_to_canonical(obj)
        rename_morph = normalize_blendshape_names(obj)

        # 1. Bake the BODY's `face` material (the only canonical role on the
        #    body OBJ that needs a flatten — backhead uses its source pack
        #    diffuse directly).
        bakes = bake_face_and_backhead(obj, head_id, out_dir)
        replace_material_diffuse_with_bake(obj, bakes, layout)

        # 2. Pull in the components mesh (eyes/teeth/lashes/mouth_interior).
        component_meshes = import_component_meshes(layout, parent=obj)

        # 3. Canonical-rename every component slot. The components import
        #    with M_ / left_eyeball / Occ naming + Blender `.NNN` suffixes;
        #    `canonical_for` + the `.NNN` strip handles both. When a target
        #    name already exists (because the body already created it),
        #    point the slot at the existing material instead of renaming
        #    (which would just create `face.001`).
        for cm in component_meshes:
            for slot in cm.material_slots:
                if slot.material is None:
                    continue
                new = canonical_for(slot.material.name)
                if new and new != slot.material.name:
                    existing = bpy.data.materials.get(new)
                    if existing and existing is not slot.material:
                        rename_mat[slot.material.name] = f"{new} (reused existing)"
                        slot.material = existing
                    else:
                        rename_mat[slot.material.name] = new
                        slot.material.name = new

        # 4. Direct-wire each component material to the addon's library
        #    textures (Eye_Diffuse1, Cornea_Normal1, teeth_color_map_001,
        #    eyelashes_alpha, etc.). The earlier Cycles-bake approach
        #    captured only the diffuse colour pass — losing the iris detail,
        #    cornea bump, and lash silhouette that ChatAvatar's node groups
        #    achieve via parallax + transmission tricks. Direct-wiring keeps
        #    the actual textures intact in the GLB.
        library_log = flatten_components_with_library_images(component_meshes)
        for role, info in library_log.items():
            bakes[role] = {"ok": True, "library_textures": info}

        # 4b. REPLACE eye DOMES with proper UV spheres.
        #     ChatAvatar's "eye" mesh is a 800-poly dome (the visible patch),
        #     not a full eyeball — Eye_Diffuse1's sphere texture doesn't fit.
        #     We hide each dome (re-assign its faces to occlusion_hidden) and
        #     drop a clean UV-sphere primitive at the dome centroid with the
        #     canonical 'eyes' material. UV sphere primitive's default mapping
        #     puts (0.5, 0.5) on the front-equator, which is exactly where the
        #     iris should appear. Replaces the stereographic UV remap.
        try:
            # Parent the new spheres to the COMPONENTS mesh (it survives the
            # body-OBJ discard step a few lines below — see "discarding body
            # OBJ"). Parenting to `obj` here would orphan them when body is
            # removed.
            survival_parent = component_meshes[0] if component_meshes else obj
            eye_sphere_stats = replace_eye_domes_with_spheres(component_meshes, survival_parent)
            print(f"[bake_head] eye spheres: {eye_sphere_stats['eyes_processed']} dome→sphere replacements")
            for s in eye_sphere_stats["spheres_created"]:
                print(f"  • {s['side']} eye @ {s['centroid']} r={s['sphere_radius']} (dome r={s['dome_radius']})")
            bakes["eye_spheres"] = {"ok": True, **eye_sphere_stats}
        except Exception as exc:  # noqa: BLE001
            print(f"[bake_head] eye sphere replacement FAILED: {exc}")
            bakes["eye_spheres"] = {"ok": False, "error": str(exc)}

        # Eye faces are now KEPT — `_build_eye_principled` swaps the eye
        # material for a proper sclera + veins + normal Principled graph
        # using the EyeTeethTex.zip pack. The body/face geometry stays
        # intact because the shape keys (jawOpen, mouthFunnel, …) are
        # encoded as per-vertex deltas on the face/lip vertices and
        # vertex-deletion would corrupt the morph deltas.

        # Re-run morph rename across the whole subtree so any PascalCase
        # shape keys carried by the components mesh land in camelCase too.
        rename_morph.update(normalize_blendshape_names(obj))

        # The body OBJ has done its job (it was the bake target for the face
        # diffuse). The components mesh now carries the full head topology
        # plus all 51 ARKit shape keys, so we keep that as the canonical
        # head and discard the body to avoid duplicate face/backhead z-fight.
        for child in list(obj.children):
            if child.type == "MESH":
                # Promote child to root so it isn't dragged out with the body.
                child.parent = None
                # Also inherit the body's normalised scale by baking it in.
                bpy.ops.object.select_all(action="DESELECT")
                bpy.context.view_layer.objects.active = child
                child.select_set(True)
                # Apply the body's prior scale so the components stay in place.
                # (At this point obj.scale is whatever import_chatavatar set;
                # normalize_size hasn't run yet — see below for ordering.)
                bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        body_to_remove = obj
        # Find a survivor mesh to be the new "head root" reference.
        new_root = next((o for o in bpy.data.objects if o.type == "MESH" and o is not body_to_remove), None)
        if new_root is None:
            print("[bake_head] WARNING: components mesh missing, keeping body OBJ")
        else:
            print(f"[bake_head] discarding body OBJ '{body_to_remove.name}', keeping '{new_root.name}' as canonical head")
            bpy.data.objects.remove(body_to_remove, do_unlink=True)
            obj = new_root
        scale_factor = normalize_size(obj)

        # Pre-export survey: walk the subtree and print which canonical roles
        # actually have face geometry. This is the only reliable way to catch
        # "head shipped without eyes" (eli/nyx in v5) without opening the GLB
        # in a viewer afterwards.
        export_survey = survey_export_scene(obj)
        print(f"[bake_head] head '{head_id}' export survey:")
        print(f"  canonical present: {export_survey['canonical_present']}")
        if export_survey["canonical_missing"]:
            print(f"  canonical MISSING: {export_survey['canonical_missing']}")
        for m in export_survey["meshes"]:
            print(f"  mesh '{m['name']}' faces={m['face_count']} morphs={m['morph_target_count']} mats={m['materials']}")

        glb_info = export_glb(obj, out_dir / f"{head_id}.glb")
        provenance_path = write_provenance(
            out_dir, head_id, source_zip, layout,
            rename_mat, rename_morph, bakes, glb_info, scale_factor,
            export_survey=export_survey,
        )
        return {
            "head_id": head_id,
            "out_dir": str(out_dir),
            "glb_path": str(out_dir / f"{head_id}.glb"),
            "provenance_path": str(provenance_path),
            "bakes": bakes,
            "material_renames": rename_mat,
            "morph_renames": rename_morph,
            "scale_factor": scale_factor,
        }
    finally:
        # Keep the temp extract for one inspection cycle, then remove later by
        # the caller. For now, leave it — it lives in /tmp and macOS cleans up.
        if os.environ.get("HEAD_BAKERY_KEEP_TMP") not in ("1", "true"):
            shutil.rmtree(extract_root, ignore_errors=True)
