# Portfolio 2026

A WebGL portfolio built with React, Three.js, and React Three Fiber. Mix of procedural geometry (instanced cog letters, custom curves, shader-deformed meshes) and Draco-compressed GLB models. No game engines, no canvas libraries beyond R3F.

## Setup

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

Dev server runs at `http://localhost:5173` by default.

## Tools used
| Tool | For |
|---|---|
| Blender | Main 3D assets including cogs, light and texture baking |
| Claude Code | Extension for GitHub |
| Figma | Image and vector manipulation |
| Meshy.ai | Decorative assets for the scene |

## Stack

| Layer | Tool |
|---|---|
| Framework | React 19 + Vite 7 |
| 3D rendering | Three.js 0.182 |
| React/Three bridge | React Three Fiber 9 |
| 3D helpers | React Three Drei 10 |
| Post-processing | @react-three/postprocessing 3 |
| Physics | @react-three/rapier 2 |
| Dev UI / tweaks | Leva |
| Build compression | vite-plugin-compression |

## Project structure

```
src/
  Portfolio2.jsx   — all scene + UI code (single-file architecture)
  sfx.js           — procedural Web Audio sound effects + background track
public/
  sounds/          — audio assets (m4a / mp3 / webm)
  textures/        — image textures and logos
  demos/           — demo videos for case study overlays
  *.glb            — 3D models (Draco compressed)
```

## Audio

Two-layer audio system, no external library:

- **Procedural sfx** (`sfx.js`) — hover, click, snap, ping, shimmer, whoosh etc. built with Web Audio API oscillators and noise buffers
- **File-based sounds** — nav interactions (m4a), ambient piano loop, mallet atmosphere, video panel data sound, background music track
- Background track uses Opus/WebM with M4A fallback for Safari
- Starts muted — user unmutes via the button in the top-right nav

## 3D models

GLBs are Draco compressed. Preloaded via `useGLTF.preload()` at module level so they're ready before the sections that need them.
