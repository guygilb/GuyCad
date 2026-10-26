# GuyCAD

**GuyCAD** is a parametric, feature-based 3D CAD program for Windows. You sketch 2D profiles with dimensions and relations, turn them into exact solid parts (extrude, revolve, fillet, chamfer, shell, patterns, mirror), then put parts together in assemblies with mates.

Its workflow and layout follow professional CAD tools such as SolidWorks: a ribbon of commands (CommandManager), a feature history tree (FeatureManager), a settings panel for the active command (PropertyManager), a floating view toolbar, and an orientation triad. The geometry is computed by **OpenCascade**, the open-source CAD kernel used by FreeCAD and many commercial products, so parts are exact solids rather than triangle approximations.

> GuyCAD is an independent project. It is not affiliated with or endorsed by Dassault Systèmes or SolidWorks.

---

## Contents

1. [Installing and running](#1-installing-and-running)
2. [Quick start: your first part](#2-quick-start-your-first-part)
3. [The screen](#3-the-screen)
4. [Sketching](#4-sketching)
5. [Part features](#5-part-features)
6. [Assemblies](#6-assemblies)
7. [Evaluate tools](#7-evaluate-tools)
8. [Files, saving and exporting](#8-files-saving-and-exporting)
9. [Customization](#9-customization)
10. [Mouse and keyboard reference](#10-mouse-and-keyboard-reference)
11. [Sample models](#11-sample-models)
12. [How it works (architecture)](#12-how-it-works-architecture)
13. [Developing GuyCAD](#13-developing-guycad)
14. [Known limitations](#14-known-limitations)
15. [Credits and licenses](#15-credits-and-licenses)

---

## 1. Installing and running

GuyCAD is a desktop application. It runs in its own window and needs no internet connection or web browser.

### Option A: download a ready-made build
Use the files from the **Releases** page of this repository (or build them yourself, see below):

| File | What it does |
|---|---|
| `GuyCAD-Setup-2.0.0.exe` | Installer. Adds Desktop and Start Menu shortcuts and registers `.gcad` / `.gasm` files so they open in GuyCAD when double-clicked. |
| `GuyCAD-2.0.0-portable.exe` | Portable. Nothing is installed; run it from any folder or a USB stick. |

The builds are not code-signed, so the first time you run one Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. You only need to do this once.

**Disk space:** about 85 MB to download and about 300 MB once installed. The app itself is small; most of the size is the built-in display engine (Chromium, via Electron) and the 22 MB OpenCascade geometry kernel.

### Option B: build from source
You need [Node.js](https://nodejs.org/) 20 or newer (tested with Node 24).

```bash
git clone https://github.com/guygilb/GuyCad.git
cd GuyCad
npm install
npm start          # builds the app and opens it in a desktop window
npm run dist       # creates the installer and portable .exe in release/
```

---

## 2. Quick start: your first part

This builds a 60 × 50 × 10 mm block with a rounded corner, then hollows it out.

1. **New part.** When GuyCAD opens, click **New Part** on the welcome screen.
2. **Choose a plane.** In the tree on the left, click **Front Plane**, then click **Sketch** on the toolbar. The view turns to face the plane and a grid appears.
3. **Draw a rectangle.** Press **R** (Corner Rectangle). Click on the red origin dot, then click again up and to the right.
4. **Dimension it.** Press **D** (Smart Dimension). Click the bottom line, click below it to place the dimension, type `60` and press Enter. Do the same for the right-hand line with `50`. The status bar now says **Fully Defined** and the lines turn black: the sketch's size and position are completely fixed.
5. **Extrude.** Click **Extruded Boss/Base**. The sketch closes and the extrude settings open on the left. Set **Depth** to `10` and click the green ✓ (or press Enter).
6. **Fillet an edge.** Click **Fillet**, click one of the block's vertical corner edges in the 3D view (it turns blue), set **Radius** to `5`, and click ✓.
7. **Shell it.** Click **Shell**, click the front face, set **Thickness** to `2`, and click ✓. The block becomes a hollow tray.
8. **Save.** Press **Ctrl+S** and choose where to save `Part1.gcad`.

Every step is listed in the tree on the left. Double-click any item (for example *Boss-Extrude1*) to change it, and everything after it rebuilds automatically.

---

## 3. The screen

```
┌ Title bar: logo · menus (File Edit View Insert Tools Help) · quick buttons · document name ─┐
├ CommandManager: big command buttons, with tabs underneath (Features / Sketch / Evaluate / View) ┤
├ Document tabs: one tab per open part or assembly, + to create a new one ─────────────────────┤
│ Left panel             │ 3D view                                          │ Task pane     │
│  • Feature tree        │  • floating view toolbar (top center)            │  • Appearances│
│  • PropertyManager     │  • ✓ / ✗ confirm corner (top right)              │  • Materials  │
│                        │  • orientation triad (bottom left)               │  • Library    │
├ Status bar: hints · busy indicator · cursor coordinates · sketch status · units ─────────────┤
```

- **CommandManager.** The main command ribbon. Its tabs change with the document type: parts have *Features, Sketch, Evaluate, View*; assemblies have *Assembly, Evaluate, View*.
- **Feature tree (FeatureManager).** The full build history of the part: material, the three standard planes, the origin, then every feature in order. A feature's sketch is nested under it. Right-click an item for options (edit, suppress, rename, delete, roll back).
- **Rollback bar.** The blue bar at the bottom of the tree. Drag it upward to see the part as it was at an earlier step. New features are inserted where the bar is. Double-click the bar to return it to the end.
- **PropertyManager.** Shows the settings of the active command: depth, radius, selected edges and so on. **✓** (or Enter) accepts, **✗** (or Esc) cancels.
- **View toolbar.** Zoom to Fit, Normal To, Section View, View Orientation, Display Style, Hide/Show items, Appearance and Screenshot.
- **Task pane (right edge).** *Appearances* (colors and finishes), *Materials* (with real densities) and the *Design Library* of sample models.
- **Status bar.** Hints for the current step, a spinner while the geometry kernel is working, cursor coordinates, the sketch status (*Under Defined / Fully Defined / Over Defined*) and the unit system. Click the unit system to switch between MMGS (mm), CGS (cm) and IPS (inch).

---

## 4. Sketching

A sketch is a 2D drawing on a plane. Closed shapes in a sketch become profiles for features such as extrude and revolve.

### Starting a sketch
- Select a plane (Front, Top or Right in the tree, or a reference plane) or **click a flat face of the model**, then click **Sketch**.
- If nothing is selected, **Sketch** asks you to pick a plane or face.
- To edit an existing sketch, double-click it in the tree, or right-click it and choose **Edit Sketch**.

### Drawing tools (Sketch tab)
| Tool | Key | How to use it |
|---|---|---|
| Line | L | Click point after point to draw a connected chain. Double-click, right-click or press Esc to stop. Clicking the starting point closes the shape. |
| Centerline | | Construction line (dashed). Not part of the profile; used as a revolve axis or as a reference. |
| Corner Rectangle | R | Click one corner, then the opposite corner. Creates 4 lines tied together with relations. |
| Center Rectangle | | Click the center, then a corner. Adds construction diagonals through the center. |
| Circle | C | Click the center, then a point on the circle. |
| 3 Point Arc | A | Click the start point, the end point, then a point the arc passes through. |
| Polygon | P | Click the center, then a corner. The number of sides is set in the PropertyManager (default 6). |

**Snapping.** While drawing, the cursor snaps to endpoints, midpoints, centers, the origin and the grid. An orange dot shows where it snapped. Lines within 3° of horizontal or vertical snap to that direction (the cursor label shows **H** or **V**). Snapping also adds the matching relation automatically, so a line drawn from an existing endpoint stays connected to it.

### Smart Dimension (D)
Dimensions *drive* the geometry: change the number and the sketch changes.

- Click a **line** for its length, a **circle** for its diameter, an **arc** or **polygon** for its radius.
- Click **two points** for the distance between them. Placing the dimension above or below the points gives a horizontal distance; to the left or right gives a vertical one; anywhere else gives the straight-line distance.
- Click **two lines** for the angle between them (or the distance, if they are parallel).
- Click **a point and a line** for the perpendicular distance.

After the second click, click empty space to place the dimension. A small box appears; type the value and press Enter. Number boxes accept arithmetic, such as `25.4*2` or `(100-4)/3`. Double-click a dimension later to change it, or drag it to move it.

If a new dimension would conflict with existing ones, it is added as a gray **driven (reference)** dimension, which shows a measurement without controlling anything.

### Relations
Relations are geometric rules that the sketch keeps true, shown as small green badges next to the geometry.

Select entities, and points (click an endpoint or center), using **Shift+click** to select several. The relations that apply to your selection appear under **Add Relations** in the PropertyManager:

| Selection | Available relations |
|---|---|
| 1 line | Horizontal, Vertical |
| 2+ lines | Parallel, Perpendicular, Equal (length), Horizontal, Vertical |
| 2+ circles/arcs | Equal (radius), Concentric, Tangent |
| line + circle/arc | Tangent |
| 2 points | Coincident, Horizontal, Vertical |
| point + line | On line, Midpoint |
| point + circle | On circle |
| points or entities | Fix |

The **Relations & Dimensions** list in the PropertyManager shows everything in the sketch (or only what touches the current selection). Click **×** to delete an item, or select its badge in the view and press Delete.

### Fully defined sketches
GuyCAD includes a geometric constraint solver. After every change it works out how many **degrees of freedom** remain:

- **Under Defined** (blue lines): some geometry can still move. The status bar shows how many degrees of freedom are left.
- **Fully Defined** (black lines): everything is fixed by dimensions and relations.
- **Over Defined** (red): something conflicts. Remove a relation or dimension.

**Dragging.** Drag any endpoint or center. Connected geometry follows according to the relations, and fully defined geometry does not move.

**Construction geometry.** Select entities and tick **For construction** (or use *Construction Geometry* on the Sketch tab) to turn them into dashed helper lines that are not part of the profile.

**Exiting.** Click **Exit Sketch** (top-left of the ribbon, or the ✓ in the top-right corner of the view). Clicking ✗ instead discards the changes made in this sketch session.

---

## 5. Part features

All features are parametric: double-click one in the tree to change it, and every later feature rebuilds from the new values.

### Extruded Boss/Base and Extruded Cut
Pushes a closed sketch profile straight out, adding material (Boss) or removing it (Cut).
- **End conditions:** *Blind* (a set depth), *Mid Plane* (half the depth on each side), *Through All* (through the entire part in one direction), *Through All - Both*.
- **Reverse direction** flips which side of the sketch plane it goes.
- Profiles may contain holes: a circle inside a rectangle makes a plate with a hole.
- If you click Extrude with no sketch ready, GuyCAD asks for a plane, lets you sketch, and returns to the extrude when you exit the sketch.

### Revolved Boss/Base and Revolved Cut
Spins a profile around an axis. The axis is a **Centerline** drawn in the sketch, or the sketch's X or Y axis. Set an angle from 0.1° to 360°. The profile must stay on one side of the axis.

### Fillet
Rounds edges. Click edges in the 3D view (they turn blue; click again to deselect) and set the radius, or tick **All edges of the body**. The PropertyManager shows the resulting volume, or an error if the radius is too large.

### Chamfer
Bevels edges at 45° by a set distance. Edges are selected the same way as for Fillet.

### Shell
Hollows the part, leaving walls of a set thickness. Click the face or faces to remove (open up). The walls are offset inward.

> While a Fillet, Chamfer or Shell is being edited, the view shows the part *before* that feature so you can pick its edges and faces. The finished result appears when you click ✓.

**How edges and faces are remembered.** GuyCAD stores a selected edge or face as a point on it. If an earlier change makes that edge disappear, the feature shows a red error in the tree saying the edge "no longer exists". Edit the feature and pick the edges again.

### Linear Pattern
Repeats the selected features along the X, Y or Z axis. Set the spacing and number of instances.

### Circular Pattern
Repeats features around the X, Y or Z axis, either spread equally over 360° or with a set angle between copies.

### Mirror
Mirrors selected features, or the entire body if nothing is selected, across a plane. You can also click the plane in the view or the tree.

### Reference Plane
Creates a plane offset from a standard plane, another reference plane or a flat face, for sketching on. Use **Flip offset** to place it on the other side.

### Managing features
Right-click a feature in the tree:
- **Edit Feature / Edit Sketch**
- **Suppress / Unsuppress:** temporarily switch the feature off.
- **Rename**
- **Delete:** also removes features that depend on it, after asking.
- **Roll Back to Here / Roll to End**
- **Hide / Show:** for sketches and planes.

Undo and redo (Ctrl+Z / Ctrl+Y) work across all of these. Inside a sketch, undo works on sketch edits.

---

## 6. Assemblies

An assembly combines several parts (called **components**) and positions them relative to each other with **mates**.

### Creating an assembly
- **File → New Assembly**, the **+** next to the document tabs, or **New Assembly** on the welcome screen.
- Or, while a part is open, **File → Make Assembly from Part**.

### Insert Components
Opens a panel where you can:
- **Browse** for a saved part file (`.gcad`),
- pick a part that is open in another tab, or
- pick a part from the Design Library.

The **first** component is **fixed** at the origin, shown as `(f)` in the tree. Later components are **floating** (`(-)`) and are placed beside the existing ones. Each component is a copy of the part stored inside the assembly file, so an assembly file is self-contained.

### Mates
Click **Mate**, then click two faces on **different** components:

| References | Mate types |
|---|---|
| Planar face + planar face | **Coincident** (faces touch), **Parallel**, **Perpendicular**, **Distance** (faces a set gap apart) |
| Cylindrical face or circular edge + another | **Concentric** (axes line up, as with a pin in a hole) |

GuyCAD suggests the right mate type and shows a live preview. For Coincident and Distance mates, **Flip alignment** chooses whether the faces point toward each other or the same way. Click ✓ to keep the mate.

The **mate solver** then moves the floating components as little as possible so that every mate holds. If a new mate conflicts with existing ones, GuyCAD says so and doesn't add it. Mates are listed under **Mates** in the tree; double-click one to edit it, or right-click to suppress or delete it.

### Moving components
Select a component, then **Move Component** or **Rotate Component**. A 3D handle (gizmo) appears; drag its arrows or rings. When you let go, the mates are re-solved, so the component can only end up in positions the mates allow. Press Esc to finish. A fixed component can't be moved; right-click it and choose **Float** first.

### Editing a component's part
Double-click a component, or right-click and choose **Edit Part**. The part opens in its own tab, labeled *in &lt;assembly name&gt;*. Change it like any part; when you switch back to the assembly tab, the component shows your changes. The part is saved together with the assembly.

### Other component options (right-click)
Hide/Show, Suppress, Fix/Float, Appearance, Material, Rename and Delete. Deleting a component also deletes its mates.

---

## 7. Evaluate tools

- **Measure.** Click faces, edges and points. Clicking near a corner or circle center snaps to it. Two clicks give the distance plus its X, Y and Z components. Each click also describes what was hit (for example *Cylindrical face, area 314.16 mm², radius 5 mm* or *Circular edge, length 31.42 mm*).
- **Mass Properties.** Mass (from the material's density), volume, surface area, center of mass and bounding-box size. Values are exact, computed by the geometry kernel from the true solid. For assemblies, every component is included, each with its own material.
- **Section View.** Cuts the view along the Front, Top or Right plane (or a reference plane) to show the inside of a part. Use the offset slider and *flip* to choose the cut position and side. Click **Section View** again to turn it off.
- **Interference Detection** (assemblies). Checks every pair of components for overlapping material and lists the overlap volume, or confirms there are no interferences.
- **Feature Statistics** (parts). Lists how long each feature took to rebuild. 0 ms means the result was reused from the cache.

---

## 8. Files, saving and exporting

| Format | Purpose |
|---|---|
| `.gcad` | A GuyCAD part. JSON text containing the whole feature history. |
| `.gasm` | A GuyCAD assembly. Contains copies of all its parts, their positions and the mates. |
| **STEP** (`.step`) | Exact solid geometry, readable by virtually every CAD program (SolidWorks, Fusion 360, FreeCAD, Onshape, Inventor…). Assemblies export as one file containing all components in position. |
| **STL** (`.stl`) | Triangle mesh for 3D printing and slicers. |
| **OBJ** / **GLB** | Meshes for rendering, games, web viewers and AR. |
| **PNG** | Screenshot of the 3D view. |

- **Save:** Ctrl+S. **Save As:** Ctrl+Shift+S. **Open:** Ctrl+O. All use the normal Windows file dialogs.
- **Export:** File → Export.
- **Auto-save:** GuyCAD keeps a copy of your latest work. If it closes unexpectedly, choose **Resume** on the welcome screen.
- **Closing with unsaved work:** GuyCAD asks before discarding changes.
- **Several documents:** each opens in its own tab. Ctrl+W closes the current one.

---

## 9. Customization

**Tools → Options** (or the gear button):
- **Your name.** Shown in the title bar and stored as the author in saved files.
- **Theme:** light or dark. **Accent color:** any color.
- **Viewport background:** gradient, plain white, dark studio or blueprint.
- **Default display style:** shaded with edges, shaded, hidden lines removed, hidden lines visible or wireframe.
- **Units:** MMGS (mm, g), CGS (cm, g) or IPS (inch, lb). Also switchable from the status bar.
- **Sketch grid spacing, snap to grid, default polygon sides, welcome screen on startup.**

**Appearances** (task pane): color swatches, a custom color picker and finishes (polished metal, satin metal, glossy or matte plastic, rubber).

**Materials** (task pane): plain carbon steel, stainless steel 304, aluminum 6061, titanium Ti-6Al-4V, brass, copper, ABS, nylon 6/6, PLA, oak and rubber, each with its real density.

---

## 10. Mouse and keyboard reference

| Action | Input |
|---|---|
| Rotate view | Left-drag (middle-drag inside a sketch) |
| Pan | Right-drag |
| Zoom | Mouse wheel (zooms toward the cursor) |
| Select face / edge / plane | Left-click; Shift+click to add to the selection |
| Context menu | Right-click |
| Standard views | `1` Front · `2` Back · `3` Left · `4` Right · `5` Top · `6` Bottom · `7` Isometric |
| Normal To (face the selection head-on) | `8` |
| Zoom to Fit | `F` |
| View orientation menu | `Space` |
| Sketch tools | `L` Line · `R` Rectangle · `C` Circle · `A` Arc · `P` Polygon · `D` Smart Dimension |
| OK / Exit sketch | `Enter` |
| Cancel / stop drawing / deselect | `Esc` |
| Delete selection | `Delete` |
| Save / Save As / Open / Close | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` / `Ctrl+W` |
| Undo / Redo / Rebuild | `Ctrl+Z` / `Ctrl+Y` / `Ctrl+B` |
| Number fields | Type math (`25.4*2`), use ↑/↓ to step, Shift+↑/↓ for 10× steps |

---

## 11. Sample models

Open these from the welcome screen or from the Design Library in the task pane:

| Sample | Shows |
|---|---|
| **Pipe Flange** | Extrusions, a fillet, a through-all cut, a circular pattern of bolt holes |
| **Angle Bracket** | An L-profile extruded mid-plane, holes cut from two directions, a mirror |
| **Revolved Vase** | A thin wall profile revolved 360° around a centerline |
| **Mounting Plate** | Slots made of arcs and lines, a linear pattern plus mirror, a hex boss on an offset plane |
| **Electronics Enclosure** | Filleted corners, a shell open at the top, a cut-out port, a chamfer |
| **Pinned Bracket** (assembly) | The bracket with two brass pins positioned by concentric and coincident mates |

---

## 12. How it works (architecture)

GuyCAD is written in JavaScript. The user interface uses web technology (HTML, CSS, three.js for 3D graphics), packaged as a desktop program with Electron.

```
┌───────────────────────── Electron desktop shell (electron/) ─────────────────────────┐
│ native window · Windows file dialogs · serves the app over an internal app:// address │
│ ┌────────────────────────── User interface (src/) ─────────────────────────────────┐ │
│ │ app.js / assembly-ui.js  commands, tree, PropertyManager, documents, tabs        │ │
│ │ viewport.js              three.js camera, display, face/edge picking, highlights │ │
│ │ sketcher.js              sketch tools, Smart Dimension, relations, annotations   │ │
│ │ constraints.js           2D constraint solver (Newton least-squares + DOF check) │ │
│ │ assembly.js              mate solver (moves components as little as possible)    │ │
│ │ geometry.js              planes, sketch profiles (exact lines & arcs)            │ │
│ └──────────────┬───────────────────────────────────────────────────────────────────┘ │
│                │ messages (background thread, keeps the UI responsive)               │
│ ┌──────────────▼──────────── Geometry kernel worker (src/kernel/) ─────────────────┐ │
│ │ part.js   rebuilds the feature history into an exact B-rep solid with replicad / │ │
│ │           OpenCascade (WebAssembly); caches each step for fast incremental edits │ │
│ │ worker.js meshing for display, face/edge data, mass properties, STEP/STL export, │ │
│ │           interference checks                                                    │ │
│ └──────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Key ideas**
- **Parametric history.** A part file is a list of features (sketches, extrudes, fillets…). The kernel replays that list to produce the solid. The result after each step is cached, so editing a late feature doesn't recompute the earlier ones.
- **Exact geometry (B-rep).** OpenCascade represents parts as true surfaces and edges. That's why fillets, shells, STEP export and exact volumes are possible. A triangle mesh is generated only for display.
- **References as points.** A selected edge or face (for fillet, chamfer, shell) is stored as a 3D point lying on it, and found again by proximity after each rebuild. This is a simple answer to CAD's "topological naming" problem: it works well, but references can be lost if earlier geometry moves.
- **Sketch solver.** Every sketch parameter (endpoints, centers, radii, angles) is a variable, and every relation or dimension is an equation. A damped Newton least-squares method takes the smallest change that satisfies all the equations, which is what makes dragging feel natural. Row-reducing the Jacobian gives the remaining degrees of freedom: that's how *Fully Defined* is detected.
- **Mate solver.** Each floating component has 6 unknowns (3 for position, 3 for rotation), solved the same smallest-change way, so components move as little as possible to satisfy the mates.

**Document format (simplified)**
```jsonc
// .gcad
{ "type": "part", "name": "Part1", "material": "Aluminum 6061", "appearance": null, "rollback": null,
  "features": [
    { "id": "f1", "type": "sketch", "name": "Sketch1", "plane": "Front",
      "entities": [ { "type": "line", "a": [0, 0], "b": [60, 0] } /* … */ ],
      "constraints": [ { "type": "horizontal", "e": 0 }, { "type": "length", "e": 0, "value": 60, "pos": [30, -12] } ] },
    { "id": "f2", "type": "extrude", "sketch": "f1", "endCondition": "blind", "depth": 10, "cut": false },
    { "id": "f3", "type": "fillet", "radius": 5, "edges": [[60, 50, 5]] } ] }

// .gasm
{ "type": "assembly", "name": "Assembly1",
  "components": [ { "id": "c1", "name": "Bracket", "part": { /* a full part document */ },
                    "position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "fixed": true } ],
  "mates": [ { "type": "concentric", "a": { "comp": "c1", "ref": { "kind": "axis", "point": [55, 0, 12], "dir": [0, 1, 0] } },
                                     "b": { "comp": "c2", "ref": { "kind": "axis", "point": [0, 0, 0], "dir": [0, 1, 0] } } } ] }
```

**Project layout**
```
electron/        desktop shell: main.cjs (window, app:// protocol, dialogs), preload.cjs, launch.cjs, icon.png
src/             application source (see diagram above), plus ui.js, icons.js, units.js, library.js, style.css
src/kernel/      OpenCascade worker: part.js, worker.js, client.js
tests/           automated tests (see below)
index.html       application page
vite.config.js   build configuration
```

---

## 13. Developing GuyCAD

```bash
npm install          # install dependencies
npm start            # build + launch the desktop app
npm run dev          # live-reloading preview in a browser at http://localhost:5173 (quick UI work)
npm run build        # build into dist/
npm run dist         # build + package installer and portable exe into release/
npm test             # run the automated tests
```

**Tests**

| Test | What it checks |
|---|---|
| `tests/kernel.test.mjs` | Feature geometry against exact formulas: extrude, cut, revolve, arcs, patterns, mirror, offset planes, fillet, chamfer, shell, lost-reference errors, every sample, incremental rebuild |
| `tests/constraints.test.mjs` | Sketch solver: relations, dimensions, editing values, conflict rejection, degree-of-freedom analysis, tangency/concentric/equal/angle |
| `tests/assembly.test.mjs` | Mate solver: concentric + coincident seating, distance mates, conflict rejection, fixed parts |
| `tests/desktop-e2e.mjs` | Drives the real desktop app with mouse clicks and keys: samples, sketch + Smart Dimension + Fully Defined, extrude, fillet and shell picked in the view, STEP export, assembly mates, interference, Edit Part |
| `tests/packaged-smoke.mjs` | Checks that the packaged `.exe` starts and builds models |

Run the desktop tests with the included driver (it controls the app through the Chrome DevTools protocol):

```bash
npm run build
ELECTRON=1 node tests/browser-driver.mjs app tests/desktop-e2e.mjs shots
ELECTRON=1 ELECTRON_EXE=release/win-unpacked/GuyCAD.exe node tests/browser-driver.mjs app tests/packaged-smoke.mjs shots
```

**Troubleshooting builds**
- *"Cannot create symbolic link"* during `npm run dist`: electron-builder's code-signing tools archive contains macOS symlinks, which Windows can't create without admin rights. Extract `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*.7z` into a folder named `winCodeSign-2.6.0` next to it, skipping the `darwin` folder, then run `npm run dist` again.
- *Electron runs as plain Node / no window appears* when started from VS Code: VS Code sets `ELECTRON_RUN_AS_NODE=1` in its terminals. `npm start` clears it automatically through `electron/launch.cjs`.

---

## 14. Known limitations

GuyCAD covers the core part-and-assembly workflow of a professional CAD package, but not everything:

- **No 2D engineering drawings** (sheets with views, dimensions and title blocks).
- **No sweeps, lofts, drafts, ribs, threads or hole wizard.** Make holes with extruded cuts.
- **Sketch tools:** no trim, extend, offset, sketch fillet, splines or text.
- **Edge and face references** are stored by position. A large upstream change can make a fillet or shell lose its edges; reselect them when that happens.
- **Assemblies:** parts only (no sub-assemblies); no gear, cam, limit or angle mates; no exploded views or motion study. Moving a component re-solves the mates when you release the gizmo, not while you drag.
- **No simulation, CAM, rendering or PDM**, which in commercial packages are separate products.
- The builds are not code-signed, so Windows SmartScreen warns on first launch.

---

## 15. Credits and licenses

- **OpenCascade Technology**, the geometry kernel, compiled to WebAssembly by the [opencascade.js](https://ocjs.org/) project: LGPL-2.1 with exception.
- **[replicad](https://replicad.xyz/)** by Steve Genoud: a JavaScript CAD library on top of OpenCascade (MIT).
- **[three.js](https://threejs.org/)**: 3D graphics (MIT).
- **[Electron](https://www.electronjs.org/)**: desktop shell (MIT). **[Vite](https://vitejs.dev/)**: build tool (MIT). **electron-builder**: packaging (MIT).

GuyCAD was created by **Guy Gilboa**.
