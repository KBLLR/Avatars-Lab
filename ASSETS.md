# Avatar Labs Assets

Large binary assets (avatars, animations, audio) are **not included** in this repository to keep it lightweight. This document explains how to obtain them.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/KBLLR/Avatars-Lab.git
cd Avatars-Lab

# Restore the local avatar cache from the preserved source snapshot
npm run assets:hydrate

# Then run
npm install
npm run dev
```

## Required Assets

### Avatars (`public/avatars/`)

The app expects Ready Player Me compatible GLB avatars in `public/avatars/`. The manifest lists required files:

| Avatar     | Source          | Notes        |
| ---------- | --------------- | ------------ |
| adam.glb   | MetaPerson SDK  | Male, casual |
| anja.glb   | Ready Player Me | Female       |
| bork.glb   | MetaPerson SDK  | Male         |
| chloe.glb  | MetaPerson SDK  | Female       |
| dan.glb    | Ready Player Me | Male         |
| dave.glb   | MetaPerson SDK  | Male         |
| david.glb  | Ready Player Me | Male         |
| donna.glb  | MetaPerson SDK  | Female       |
| eli.glb    | MetaPerson SDK  | Male         |
| julien.glb | Ready Player Me | Male         |
| lana.glb   | Ready Player Me | Female       |
| lucy.glb   | Ready Player Me | Female       |
| nyx.glb    | Ready Player Me | Female       |
| rick.glb   | MetaPerson SDK  | Male         |
| sandri.glb | MetaPerson SDK  | Female       |
| sara.glb   | Ready Player Me | Female       |

### Creating Your Own Avatars

1. Go to [Ready Player Me](https://readyplayer.me/)
2. Create an avatar
3. Download as GLB with these settings:
   - Mesh LOD: High
   - Texture Atlas: 1024 or 2048
   - Pose: T-Pose or A-Pose
4. Place in `public/avatars/`
5. Add filename to `public/avatars/manifest.json`

### Animations (`public/animations/`)

For dance/pose animations, use Mixamo:

1. Go to [Mixamo](https://www.mixamo.com/)
2. Upload your avatar or use a Mixamo character
3. Browse animations and download as FBX
4. Place in `public/animations/`

**Recommended animations:**

- Hip Hop Dancing
- House Dancing
- Robot Dance
- Victory poses
- Idle animations

### Audio Files

Test audio files are needed for:

- TTS output testing
- Lip sync validation
- Performance playback

Use any WAV/MP3 files or generate with TTS.

### Performance Engine ecosystem assets

`engine-lab.html` does not copy Core-X heads, HDR environments, or the curated
Rigging Portal FBX library into this repository. During local development and
preview, Vite exposes those owning directories through read-only routes with
byte-range support:

- `/corex-assets`: `core-x/ui/public` heads and HDRIs
- `/performance-assets/animations`: Rigging Portal's 17 curated FBX files
- `/performance-assets/rpm`: Project Anja's 22 locally available RPM-retargeted FBX files
- `/performance-assets/catalog.json`: generated metadata for reachable files only

The default paths assume the Core-X monorepo layout. Override them for a
standalone house checkout:

```bash
AVATAR_LABS_COREX_PUBLIC_ROOT=/absolute/path/to/core-x/ui/public \
AVATAR_LABS_ANIMATION_ROOT=/absolute/path/to/rigging-portal/public/animation-library/fbx \
AVATAR_LABS_RPM_ANIMATION_ROOT=/absolute/path/to/project-anja/public/assets/animations/mixamo \
npm run dev
```

Missing files return JSON `404` responses rather than the Vite HTML fallback. The
historical `public/dance/library.json` describes a larger upstream collection, but its
absent URLs are not advertised by Performance Engine. Rigged-body motion requires matching
named bones; Mixamo/RPM prefixes are normalized during playback, while rig-less Core-X
heads use morph expressions and TSL looks instead.

Attached score audio stays local unless the operator explicitly publishes it to Warehouse.
Performance projects store only editable analysis evidence: energy envelope, beat/onset times,
semantic sections, diarised speaker turns, and singer-to-actor assignments. They never persist
Audio Lab's temporary server-side upload path. Audio Lab-generated WAV/MP3 files, transcript
scratch files, and diarisation intermediates belong in its ignored `data-pool/voice-snip/`
runtime area, not this house repository.

Rapier is a code dependency, not an asset source. Its WebAssembly payload is emitted as a
dynamically loaded build chunk and is requested only when the Confetti physics stage effect is
active. Procedural backdrops and particle textures are generated at runtime; do not add copied
shader previews or generated particle media to source control.

## Asset Hydration

`npm run dev` and `npm run build` call the hydrator automatically. It writes
ignored GLB files plus `public/avatars/runtime-manifest.json`; the runtime
manifest contains only models that passed the GLB signature check.

### Option 1: Core-X local asset root

```bash
AVATAR_LABS_ASSET_ROOT=/absolute/path/to/avatar-glbs npm run assets:hydrate
```

The asset root is checked first and can be a Warehouse-resolved local view. The
house never commits or hardcodes that machine-local path.

### Option 2: Preserved source snapshot

```bash
npm run assets:hydrate
```

The default hydrator restores the original full-body avatars from the reachable
Git snapshot recorded in `scripts/hydrate-avatar-assets.mjs`. A shallow clone
without that snapshot falls back to the tracked preview fixture instead of
advertising broken avatar options.

### Option 3: Manual assets

Place compatible GLBs in `public/avatars/`, then run the hydrator to regenerate
the runtime manifest.

### Option 4: Create Minimal Set

For development, you only need ONE avatar:

1. Create avatar at [Ready Player Me](https://readyplayer.me/)
2. Download GLB
3. Save as `public/avatars/test.glb`
4. Update manifest:
   ```json
   {
     "avatars": ["test.glb"]
   }
   ```

## Directory Structure

```
public/
├── avatars/
│   ├── manifest.json     # Lists available avatars (tracked)
│   ├── runtime-manifest.json # Generated list of verified local assets (ignored)
│   ├── .gitkeep          # Preserves empty dir (tracked)
│   ├── *.glb             # Avatar models (NOT tracked)
│   └── */                # Subdirs for complex avatars (NOT tracked)
├── animations/
│   ├── .gitkeep          # Preserves empty dir (tracked)
│   └── *.fbx             # Mixamo animations (NOT tracked)
├── dance/
│   └── library.json      # Dance clip metadata (tracked)
└── gestures/
    └── library.json      # Gesture clip metadata (tracked)
```

## Test Fixtures

The `fixtures/` directory contains minimal assets for CI/testing:

- `fixtures/avatars/brunette.glb` - Small test avatar (4.7MB)
- `fixtures/audio/hello.wav` - Short audio clip (700KB)

These ARE tracked in git as they're required for automated tests.

## Troubleshooting

### "Avatar not found" error

1. Check `public/avatars/` contains GLB files
2. Verify filenames match `manifest.json`
3. Ensure files are valid GLB (try opening in Blender)

### Animations not playing

1. Verify FBX is in `public/animations/`
2. Check animation is Mixamo-compatible
3. Ensure avatar has matching bone structure

### Large repo clone

If you accidentally committed large files:

```bash
# Check repo size
git count-objects -vH

# Remove large files from history (DANGEROUS - rewrites history)
git filter-branch --force --index-filter \
  'git rm -rf --cached --ignore-unmatch public/avatars/' \
  --prune-empty --tag-name-filter cat -- --all
```

## Contributing Assets

Do NOT commit large binary files to git. Instead:

1. Upload to asset server
2. Update manifest/library JSON files
3. Document in this file
4. Submit PR with metadata only
