# Neck motion study

Open Core-X Head and select Rosalia or Nyx. Use Turn for an easing turn and return, Nod yes for pitch, and Shake no for alternating yaw. These controls run locally and require neither audio nor model inference.

## Design

Both shared GLBs contain facial morph targets and have zero glTF skins. A transform on the bust would rotate the shoulders with the skull. The prototype binds the loaded meshes to a chest anchor, neck and head. The chest stays fixed, the neck and head divide pitch and yaw, and smooth height weights distribute the bend over the neck. Matching positions on split material primitives receive the same weights. Eyes, teeth and companion hair follow the skull. Materials, UVs and morph channels are kept from the source. This is a runtime rig in Core-X Head. The shared assets remain the unrigged source GLBs.

For a reusable rig, author and inspect the armature in Blender, then export a separate skinned GLB. Fit joint pivots per character, blend weights across the neck and keep eye, tooth and hair weights rigid. Inspect open jaw, blink and blink-plus-turn before export. Reimport the GLB and compare neutral pose, morph names and positions, both yaw directions, nod and reset. Procedural height weights are a starting point for that review. Deep turns, severe flexion and asset-specific corrective shapes remain unverified.

- Blender's armature and vertex-group workflow supports editing deform weights per character. [Blender Studio weight painting](https://studio.blender.org/training/blender-fundamentals-45-lts/blender_4-5_lts_rigging_weight-painting/)
- The runtime uses the skin-index and skin-weight buffers defined by Three.js. glTF supports joint skinning and morph targets on the same mesh. [Three.js SkinnedMesh](https://github.com/mrdoob/three.js/blob/dev/docs/pages/SkinnedMesh.html.md) · [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.pdf)

## Shared asset

Rosalia resolves from the standard Core-X head root at `avatars/heads/rosalia/rosalia.glb`. The file is the existing ChatAvatar bakery preview derivative with invalid oral primitives excluded. SHA-256 is `145b961e98ea533302f9d9531863c85b5d4c05b14dfa9e0ee4b534ae0285a7b9`. Use the single shared GLB. Keep the source export pack and textures out of the house repository. The asset and roster changes are local pending repository promotion.

## Full roster, expressive gestures, and eye tracking

The Core-X Head case now binds every head in its roster at load time. Eye geometry gets one pivot per globe, including exports that pack both eyes into one primitive. Neck and skull rotations share pitch, yaw, and roll. The head/neck totals are bounded to roughly 13°, 26°, and 8° respectively. Eye pitch and yaw are bounded to roughly 6° and 9° relative to the head. During a blink, gaze offsets fade toward neutral to reduce iris clipping. Rosalia’s centered iris has a 25% larger nominal diameter in the preview via a diffuse UV adjustment. Her source GLB and eye geometry stay intact.

The case offers Turn, Nod yes, Shake no, Acknowledge, Consider, and Brighten. Existing local speech pre-analysis chooses at most three distinct, spaced cues from the text and emotion timeline. WAV playback uses the decoded duration. Streaming estimates duration from text until the PCM length is known. Cues therefore have sentence-level timing. Emotion override controls use the same gesture library. Expressive speech gestures can be switched off and default off when reduced motion is requested.

Follow pointer is an opt-in mode. The eyes respond ahead of the neck, ease back to neutral when the pointer leaves, and yield during camera dragging. This is a bounded stage-relative target. It does not use a webcam or a model. The controls and speech integration are specific to Core-X Head.

Voice selection reads the configured Gateway’s voice list. The dropdown marks the head’s default and remembers per-head overrides for the open page. Stream and WAV playback use the selected voice. If the voice list is unavailable, the dropdown shows the head default and an explicit status.
