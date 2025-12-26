# Avatar Labs Assets

Large binary assets (avatars, animations, audio) are **not included** in this repository to keep it lightweight. This document explains how to obtain them.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/KBLLR/Avatars-Lab.git
cd Avatars-Lab

# Download assets (choose one method below)
# Then run
npm install
npm run dev
```

## Required Assets

### Avatars (`public/avatars/`)

The app expects Ready Player Me compatible GLB avatars in `public/avatars/`. The manifest lists required files:

| Avatar | Source | Notes |
|--------|--------|-------|
| adam.glb | Ready Player Me | Male, casual |
| anja.glb | Ready Player Me | Female |
| bork.glb | Ready Player Me | Male |
| chloe.glb | Ready Player Me | Female |
| dan.glb | Ready Player Me | Male |
| dave.glb | Ready Player Me | Male |
| david.glb | Ready Player Me | Male |
| donna.glb | Ready Player Me | Female |
| eli.glb | Ready Player Me | Male |
| julien.glb | Ready Player Me | Male |
| lana.glb | Ready Player Me | Female |
| lucy.glb | Ready Player Me | Female |
| nyx.glb | Ready Player Me | Female |
| rick.glb | Ready Player Me | Male |
| sandri.glb | Ready Player Me | Female |
| sara.glb | Ready Player Me | Female |

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

## Asset Download Options

### Option 1: Download from Asset Server (Recommended)

If you have access to the HTDI asset server:

```bash
# From project root
./scripts/download-assets.sh
```

### Option 2: Sync from S3/GCS

```bash
# AWS S3
aws s3 sync s3://htdi-assets/avatar-labs/avatars public/avatars/

# Google Cloud Storage
gsutil -m rsync -r gs://htdi-assets/avatar-labs/avatars public/avatars/
```

### Option 3: Manual Download

Contact the team for access to the asset archive.

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
