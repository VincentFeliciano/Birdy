# Birdy

A Windows desktop web browser that becomes a 3D-printing workspace the moment you open a model.
Browse any model site, download an STL, and it opens beside the page: inspect it, check whether it
will print, fix scale and orientation, save a copy, and hand it to your slicer without switching apps.

Neon-on-black interface with a selectable glow colour.

## Install

Download `Birdy-Setup-x.y.z.exe` from [Releases](../../releases) and run it.
The installer is not code-signed yet, so Windows SmartScreen may ask you to confirm (More info → Run anyway).

## What it does

**Browser**
- Tabs, address bar, back / forward / reload / home, session restore, page zoom (Ctrl + / − / 0)
- Google search tuned for 3D: a selector next to the address bar searches for 3D models, STL, 3MF, OBJ, GLB/glTF, STEP, assets, or the plain web
- Bookmarks (star in the address bar)
- Downloads saved to `Documents\Birdy\Downloads`, with progress, cancel, retry, and duplicate detection by SHA-256

**Workspace** (split view beside the website, resizable)
- Opens STL, 3MF, OBJ, GLB/glTF and PLY: from downloads automatically, by drag and drop, or with Ctrl+O
- Orbit, pan, zoom, fit; ISO / front / back / left / right / top / bottom views; perspective or orthographic
- Build-plate grid, axes, bounding box, wireframe, snapping
- Move / rotate / scale gizmo and exact numeric fields, size in mm, uniform lock, mirror, drop to plate, center, reset
- Dimensions in mm and inches, triangle and object counts
- **Print check**: corrupt data, truncated files, holes (not watertight), non-manifold edges, flipped or inside-out faces, zero-area triangles, fit on a 256 mm plate, below or floating above the plate, parts in mid-air, overhangs that need supports, and unit mistakes. Verdict: *Ready to print*, *Needs attention*, or *Won't print as-is*. Runs in a background worker.
- Save As STL or OBJ (originals are never modified; saved files are read back and verified)
- **Open in slicer**: auto-detects OrcaSlicer, Bambu Studio, PrusaSlicer and UltiMaker Cura, or you can pick any slicer executable

**Library**
- Groups for organising bookmarks and saved models (create, rename, delete)
- Model cards with thumbnail and print-check badge; open straight into the workspace

## Develop

```powershell
npm install
npm run dev        # run with hot reload
npm run check      # type-check renderer and main process
npm test           # print-check unit tests
npm run dist       # build the Windows installer into release/
```

Stack: Electron, Svelte 5, TypeScript, Vite (electron-vite) and Three.js.

```
electron/   main process: tabs (WebContentsView), downloads, files, library, slicer launcher, security
src/        app UI: browser chrome, workspace, model editor, library, 3D engine
resources/  bundled start page
tests/      print-check tests
```

Security: websites run in sandboxed views with no Node access and no preload. The app UI talks to the
main process only through a small, typed, sender-checked IPC surface. Downloaded files are never executed.

## Credits

Birdy works alongside these open-source projects. Slicers are separate programs you install;
Birdy hands them your model file.

- [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) (AGPL-3.0)
- [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) (AGPL-3.0)
- [UltiMaker Cura](https://github.com/Ultimaker/Cura) (LGPL-3.0; CuraEngine is AGPL-3.0)
- [Three.js](https://github.com/mrdoob/three.js), [Electron](https://github.com/electron/electron) and [Svelte](https://github.com/sveltejs/svelte) (MIT)
