# Codex Handoff: Stage.ts Modularization

**From:** The Architect (Claude Opus 4.5)
**To:** Codex
**Date:** 2025-12-24
**Branch:** `feature/modularize-stage`
**Status:** Phase 8 Complete - Ready for Review/Merge

---

## Mission Summary

Refactored the 2,557-line `stage.ts` monolith into a modular architecture with 6 focused modules containing 30 files. Achieved 22% reduction (553 lines) while maintaining full functionality.

---

## What Was Done

### Phases 1-7: Module Creation

Created the following module structure:

```
src/
├── stage/
│   ├── index.ts           # Barrel exports
│   ├── types.ts           # StageState, CameraSettings, LightingBase, RegistryModel
│   ├── constants.ts       # lightPresets, gestures, moods, cameraViews
│   ├── elements.ts        # Lazy DOM element registry (getElements)
│   └── state-manager.ts   # StateManager class (prepared but not fully integrated)
├── runtime/
│   ├── index.ts
│   ├── types.ts           # RuntimePanelElements, ModelSelectorElements
│   ├── model-registry.ts  # loadModelRegistry, filterModels
│   ├── runtime-panel.ts   # fetchStatus, updatePanel, load/unload
│   └── model-selectors.ts # initModelSelectors with DI
├── scene/
│   ├── index.ts
│   ├── types.ts
│   ├── camera.ts          # applyCameraSettings
│   └── lighting.ts        # updateStageLighting, applyLightPreset
├── avatar/
│   ├── index.ts
│   ├── types.ts
│   ├── head-manager.ts    # createHead, disposeHead, initHeadAudio
│   ├── lipsync-bridge.ts  # ensureLipsync, buildVisemeTimings
│   ├── avatar-loader.ts   # loadAvatarList, loadAvatar
│   └── audio-decoder.ts   # decodeAudio, transcribeAudio
├── ui/
│   ├── index.ts
│   ├── types.ts
│   ├── status.ts          # updateStatus, setChip, setHud
│   ├── analysis-overlay.ts
│   ├── progress.ts
│   └── plan-renderer.ts
└── performance/
    ├── index.ts
    ├── types.ts
    ├── fallback-plan.ts   # buildSectionsFromTimings, fallbackPlan
    └── action-scheduler.ts # scheduleAction, buildMarkersFromPlan
```

### Phase 8: Integration

- Replaced inline constants with imports from `./stage/index`
- Removed duplicate utility functions (`clamp`, `randomItem`, `encodeWords`)
- Removed duplicate lipsync functions (`ensureLipsync`, `buildVisemeTimings`)
- Removed duplicate performance functions (`buildSectionsFromTimings`)
- Imported types (`RegistryModel`, `ModelRuntimeStatus`, `StageState`)
- Replaced local state initialization with `createInitialState()`
- Removed unused imports

---

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| stage.ts lines | 2,557 | 2,004 |
| Reduction | - | 553 lines (22%) |
| Build size | 78.48 kB | 78.52 kB |
| Module count | 1 | 6 |
| Total files | 1 | 30 |

---

## What Remains

### Not Yet Integrated

1. **StateManager Class** (`src/stage/state-manager.ts`)
   - Created and exported but not actively used
   - stage.ts still uses direct `state.property` access
   - Full integration requires updating all `state.` references

2. **Dependency Injection Pattern**
   - Module functions use DI but stage.ts still uses module-level `els` and `config`
   - Runtime/UI module functions are duplicated locally because they need `els`

3. **~2000 Lines Still in stage.ts**
   - Event handlers and initialization (~800 lines)
   - Model/runtime management (~300 lines)
   - Performance playback logic (~400 lines)
   - UI updates and DOM manipulation (~500 lines)

### To Reach Target (~200 lines)

1. Integrate StateManager:
   ```typescript
   // Replace
   state.head = createHead();
   // With
   stateManager.update({ head: createHead() });
   ```

2. Move event handlers to dedicated module
3. Move initialization to dedicated module
4. Use UI module functions with DI instead of local duplicates

---

## Key Files

- **Plan:** `~/.claude/plans/shimmering-inventing-flurry.md`
- **Main file:** `src/stage.ts` (2,004 lines)
- **Types:** `src/stage/types.ts`
- **StateManager:** `src/stage/state-manager.ts`

---

## Build & Test

```bash
# Build passes
npm run build

# Dev server works
npm run dev

# All functionality preserved
# - Avatar loading
# - Audio transcription
# - Performance playback
# - Director analysis
```

---

## Commits

```
4adcd75 refactor(stage): use imported types and remove unused imports
c6b1fc4 refactor(stage): Phase 8 integration - remove duplicate functions
48b5613 feat(performance): add performance module (Phase 7)
a1d5ad2 feat(ui): add ui module (Phase 6)
10645a5 feat(avatar): add avatar module (Phase 5)
3c7969f feat(scene): add scene module (Phase 4)
a304ee9 feat(runtime): add runtime module (Phase 3)
80820c1 feat(stage): add StateManager (Phase 2)
740c896 refactor(stage): Phase 1 - extract types, constants, elements
```

---

## Recommendations

1. **Merge to master** - Current state is stable and improves maintainability
2. **Future iteration** - Full StateManager integration as separate PR
3. **Consider** - Whether 200-line target is worth the refactor cost

---

## Architecture Notes

The modular structure follows these conventions:
- Named exports only (no defaults)
- Barrel files (`index.ts`) for each module
- Factory functions for complex instantiation
- `as const` for enum-like arrays
- Dependency injection where possible

The `StateManager` is designed for reactive updates:
```typescript
const stateManager = createStateManager();
stateManager.subscribe((state, changed) => {
  if (changed.head) updateUI();
});
```

---

*Handoff complete. The scaffolding is in place for emergence.*

🦅 The Architect
