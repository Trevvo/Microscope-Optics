# Maintainer notes (for Claude)

Static web app: a spectral light-path simulator for the lab's widefield scope. It's hosted on GitHub Pages; Firebase provides Auth and Firestore. The user-facing README.md covers usage and setup. This file covers what you need in order to change things safely.

## Commands
- `npm run dev`: runs at localhost:5173. With an empty `apiKey` in `src/firebase-config.js` it runs in **local mode** (localStorage, no login).
- `npm test`: vitest.
  - `tests/physics.test.js`: the model.
  - `tests/describe.test.js`: checks that JS and Python filter labels agree. It reads `public/data/fpbase`.
- `npm run build`: set `BASE_PATH=/<repo>/` for Pages; the GitHub Action does this.
- `python3 scripts/fetch_fpbase.py`: rebuilds `public/data/fpbase/`.
  - It resumes from `scripts/.cache/` (gitignored). A fresh run takes about 5 minutes.
  - `--refresh` refetches the metadata.
- `python3 scripts/verify_spectrax_unfiltered.py`: re-checks the SpectraX LED spectra against Lumencor's manual.

## Architecture
- **Grid:** `src/physics/grid.js`, 300–1000 nm at 1 nm (N = 701). `GRID` in the Python script must match.
- **Model:** `src/physics/simulate.js` is pure and has no DOM access. Its input is arrays; an empty slot is `null` and means T = 1.
  - Path: LED (normalized to equal power, then converted to photons ×λ) → paddle → cube exciter → cube dichroic R = 1−T → sample.
  - Fluorophores: ex spectra are peak-normalized and em spectra area-normalized.
  - Emission path: dichroic T → emitter → Gemini (T → cam A, 1−T → cam B; no dichroic means bypass to `bypassTo`) → arm filter → QE.
  - Outputs: `signal / composition / rowPct / relBright`, `steps`, `cumulative` (per emission point, used for the beam hover), `ledLines`, `emittedBy`, `leakage`.
- **Config → input:** `src/resolve.js` turns a config document (IDs only) into simulate input and builds the warnings.
- **Spectra store:** `src/data/spectraStore.js` loads `index.json` and lazily fetches `s/{id}.json` (`{v: ints/1e5}`).
  - Custom spectra have IDs `c:<id>`.
  - `display(id)` returns `{title: label || name, brand}`.
- **Main:** `src/main.js` holds all state and the render loop (rAF). Every doc edit goes through `edit()` (re-render) or `editQuiet()` (no re-render, for text inputs). It autosaves after 1.2 s of inactivity, and at least every 5 s.
- **Concurrent editing** (verified live with two sessions):
  - `backend.saveConfig(id, local, base)` runs a Firestore **transaction**. It reads the server copy, calls `merge3(base, local, server)` from `src/merge.js`, and writes the merged document, or writes nothing if there's a conflict.
  - `state.base` is the last synced content; update it on every apply or save.
  - Merge rules: objects merge key by key; equal-length object arrays (acquisitions, leds, fluors) merge per element; `ledsOn` and scalars are atomic.
  - On a conflict, `state.conflict` is set, autosave pauses, and the banner offers **Use theirs** / **Keep mine**. Keep mine sets the base to their version, so our values win.
  - Incoming snapshots while dirty are merged live the same way.
  - Plain whole-document `setDoc` saves lost edits in a race. **Don't go back to it.**
- **UI modules:**
  - `ui/diagram.js`: SVG with `viewBox` 1320×752, laid out to fill a laptop-shaped stage. Right edge, full height: SpectraX. Upper middle-right: excitation panel (`EX_PANEL`), by the light source. Left: Gemini and cameras, each with an always-on, minimizable graph of the light reaching it plus its signal share (`camPanel`, `CAM_PANEL`). Cameras are drawn by `cameraGlyph()`, facing their beam. Minimize state is in the per-browser prefs (`exMin`, `camMin`). Layout constants (`VIEW`, `LED_Y0/DY`, `STAGE_Y`, `CX`, `CELL_SCALE`) are at the top; slot positions are in `slots()`. Keep label text at 12.5 px or larger. `slots()` defines every clickable slot (id, x/y, `cats`, get/set). `exPanel` is the excitation plot, drawn in SVG. It also draws the cell, the camera readouts, and the cube button.
  - `ui/picker.js`: the part picker with columns pref / all / ours. `accepts()` enforces slot typing: filter slots take `F` with `sub != BS`, dichroic slots take only `BS`.
  - `ui/cubeMenu.js`: the presets menu.
  - `ui/fluorPopover.js`
  - `ui/beamTooltip.js`
  - `ui/topbar.js`: title/menu, notes, acquisition tabs, Details button.
  - `ui/readouts.js`: the Details drawer.
  - `ui/plots.js`: uPlot wrapper.
- **Popovers** are `position: fixed` and clamped by `placeInViewport()` plus a ResizeObserver. The user requires that **the page never scroll**; keep `#app` at `overflow: hidden`.

## Data pipeline (`scripts/fetch_fpbase.py`)
- FPbase GraphQL at `https://www.fpbase.org/graphql/`. It sends **no CORS headers**, which is why the snapshot is bundled with the site.
- Spectrum 6954 contains NaN; batches are accepted with `partial=True`.
- Resampled to the grid and scaled ×1e5. That precision is needed to keep filter blocking of about OD 5.
- **LEDs:** FPbase "SpectraX *" spectra are **filtered** outputs with a >850 nm noise tail. `clean_led()` cleans them and flags them `filtered`.
  - The LED slots use FPbase **"Spectra X23 *"**, which match Lumencor's unfiltered Figure 7 (manual 57-10039; r ≥ 0.998).
- **Parts FPbase lacks:** add them to `EXTRA_SEMROCK`. They come from Semrock SearchLight: POST `https://searchlight.idex-hs.com/services/site/GetComponentList {type:"filter"}`, then `GetSpectraForPlotting {components:[{Name,Key,Components:[]}],resolution:0}`. The ID prefix is `sl-`. The current entry is FF699-FDi01.
- **Filter labels:** `describe()` computes "c ± h" per passband (FWHM at 50% of max, 3-pt smoothed, ripple under 6 nm merged, only bands centered 350–850 nm shown, LP/SP for open ends). Dichroics get their rising 50% edges plus " nm".
  - Outputs are `label` and `alt` (search keys).
  - **Mirrored in `src/data/describe.js`** (used for custom spectra). Change both, including banker's rounding (`pyRound`), and run the parity test.
  - Measured widths legitimately exceed Semrock nominal widths (e.g. FF01-635/18 → 635 ± 12).

## Config schema (`src/schema.js`)
- Fields: `{name, description (the UI "Notes"), schemaVersion: 2, archived, leds[{key,label,spectrumId,paddleId}], cube{exciterId,dichroicId,emitterId}, splitter{dichroicId,bypassTo:'A'|'B',armA{filterId,cameraId},armB{…}}, fluors[{key,enabled}], acquisitions[{name,ledsOn[],intended{A,B}}]}`.
- Server-stamped fields are `updatedAt`, `updatedBy`, `updatedSession`.
- LED keys: `violet blue cyan green red nir`. Their labels are UV-Violet, Blue, Cyan-Teal, Green-Yellow, Red-Far Red, NIR.
- `migrateLeds()` upgrades v1 documents (old filtered SpectraX IDs, `teal` key). Any new field needs a default in `normalizeConfig()`, and possibly a `schemaVersion` bump with a migration.
- Fluorophore keys: `p<stateId>` (protein) or `d<dyeId>` (dye).
- Camera keys stay **A/B internally** but display as **Camera 1/2** (A = Gemini-transmitted).

## Backend (`src/backend.js`)
- The same interface is implemented by FirebaseBackend and LocalBackend.
- Firestore collections:
  - `configs/{id}`
  - `configs/{id}/revisions/*`: append-only snapshots. One is taken before a user's first edit in a session, then autosnapshots at most every 10 min, plus manual "Save version".
  - `customSpectra/*`: append-only.
  - `settings/inventory {ids}`: the "our filters" list.
- `firestore.rules` requires sign-in, validates shapes, and forbids deletes. **If you add document fields, update `validConfig` `hasOnly`, or saves will fail.**
- Login: the username is mapped to `<user>@scope.lab` (`USERNAME_DOMAIN`). The user creates accounts by hand, with sign-up disabled.

## Lab parts (`src/data/labParts.js`)
- **`DEFAULT_INVENTORY`** only seeds `settings/inventory` when that document doesn't exist. After go-live, editing this array does NOT change the live list. Users edit it with ★ in the picker, or you write the Firestore document.
- **`CUBE_PRESETS`**: `{exciter?, dichroic, emitter, paddles?}`. When `paddles` is present, each exciter goes on the LED with the largest normalized overlap (`applyPreset` in main.js) and the cube exciter is set to null. `matchPreset()` drives the cube label.
- **`PADDLE_PREFERRED[ledKey]`** is the picker's "Preferred" column, shown only for paddle slots.
- Parts are referenced by snapshot **names**. After a snapshot refresh, check they still resolve (the chk pattern: map `index.json` names).
- Mapping guesses the user hasn't confirmed:
  - "554/24" → FF01-544/24
  - Lumencor for 575/25, 730/40, 438/29, 510/25, 555/28
  - "532 dichroic" → Semrock DI03-R532
  - "560 dichroic" → FF560-FDi01
  - Chroma ET for 545/40, 555/25, 667/30

## Decisions the user made (don't silently revert)
- EC and QY are **not used**: all fluorophores are equally bright at their peak. `simulate` defaults EC and QY to 1.
- Equal integrated power per LED. Lumencor's absolute powers are known (about 720/770/600/1680/430/360 mW for U/B/C/G/R/N) but deliberately unused.
- Layout and style:
  - The page is a single full-screen light path, laid out right to left (LEDs right, cameras left), with a dark theme.
  - Detailed graphs live in the drawer behind the top-right button.
  - The excitation panel is always on but can be minimized.
- Everything requires login; there is no anonymous editing.

## Gotchas
- SVG glow filters must use `filterUnits="userSpaceOnUse"`. Otherwise perfectly straight beams (zero-height bounding box) vanish.
- Headless browser testing uses puppeteer-core with the system Chrome (`/Applications/Google Chrome.app/…`). Keep test scripts in the scratchpad, not the repo.
  - Each launch gets a fresh profile, so localStorage isn't shared between runs.
  - A hash-only `goto` doesn't reload the page.
  - The `beforeunload` prompt (shown while there are unsaved edits) blocks `browser.close()`, so wait longer than 1.5 s after an edit before closing.
- The Firestore emulator needs Java, which isn't installed here. To test against the live project, run `npm run dev`; `localhost` is authorized by default in Firebase Auth. Use separate `browser.createBrowserContext()` contexts for multi-user tests, and restore any data you change.
- **Live deployment:** https://trevvo.github.io/Microscope-Optics/ (GitHub repo `Trevvo/Microscope-Optics`; Firebase project `microscope-optics`). Pushing to `main` redeploys.
- FPbase's data license was never confirmed (see `public/data/fpbase/ATTRIBUTION.md`).
