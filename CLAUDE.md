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
  - Each acquisition has its own cube (`acquisitions[i].cube`, falling back to `input.cube`), so detection is computed per acquisition. `signal` uses each channel's own acquisition.
  - Outputs: `signal / composition / rowPct / relBright`, `ledLines`, `emittedBy`, `leakage`. Per acquisition: `steps`, `cumulative` (per emission point, used for the emission hover), `detection`, `activeCams`, `collection`, plus `exBy` (per LED: `raw` before and `afterPaddle`) and `exCum` (cumulative excitation transmission after the paddles at `source`, `ex:exciter`, `ex:cubeDichroic`, `leak`), used for the excitation hover. Per fluorophore: `collectionByAcq[ai]`.
  - `result.cumulative`, `result.detection`, `result.activeCams` and `fluors[i].collection` are acquisition 0's values, kept for older callers. UI code should read the current acquisition's values.
- **Config → input:** `src/resolve.js` turns a config document (IDs only) into simulate input and builds the warnings.
- **Spectra store:** `src/data/spectraStore.js` loads `index.json` and lazily fetches `s/{id}.json` (`{v: ints/1e5}`).
  - Custom spectra have IDs `c:<id>`.
  - `display(id)` returns `{title: label || name, brand}`.
- **Main:** `src/main.js` holds all state and the render loop (rAF). Every doc edit goes through `edit()` (re-render) or `editQuiet()` (no re-render, for text inputs).
  - **There is no autosave.** Edits only mark the config dirty. `save()` runs on the Save button or Ctrl/⌘+S.
  - Switching config or signing out with unsaved changes shows `confirmUnsaved()` (Save / Discard / Cancel).
  - Each successful Save writes a revision with `kind: 'save'`. "Save version…" writes `kind: 'manual'`.
  - Older revisions have no `kind`; `revisionKind()` in schema.js sorts them by label.
- **TEST:** the doc ID is `TEST` (`TEST_ID` in schema.js). It's created on login by `backend.ensureConfig` if missing, and every session lands on it. It's pinned first in the dropdown above a separator. It can't be renamed (UI) or deleted (UI and rules).
- **Delete:** `backend.deleteConfig` deletes the revisions in batches, then the config. It's behind a two-step confirm. Archive is gone; `archived` stays an optional field so old documents validate.
- **Concurrent editing** (verified live with two sessions):
  - `backend.saveConfig(id, local, base)` runs a Firestore **transaction**. It reads the server copy, calls `merge3(base, local, server)` from `src/merge.js`, and writes the merged document, or writes nothing if there's a conflict.
  - `state.base` is the last synced content; update it on every apply or save.
  - Merge rules: objects merge key by key; equal-length object arrays (acquisitions, leds, fluors) merge per element; `ledsOn` and scalars are atomic.
  - On a conflict, `state.conflict` is set, autosave pauses, and the banner offers **Use theirs** / **Keep mine**. Keep mine sets the base to their version, so our values win.
  - Incoming snapshots while dirty are merged live the same way.
  - Plain whole-document `setDoc` saves lost edits in a race. **Don't go back to it.**
- **UI modules:**
  - `ui/diagram.js`: SVG 752 units tall. Its width follows the stage's aspect ratio (`layout(W)`, minimum 1320), so it fills the screen edge to edge. `L.R` is the offset for right-anchored parts; `L.s` is half the extra width, used to shift the centre block and widen the left column. Anything positioned must use `L.*`, not literals. Right edge, full height: SpectraX. Upper middle-right: excitation panel (`EX_PANEL`), by the light source. Left: Gemini and cameras, each with an always-on, minimizable graph of the light reaching it plus its signal share (`camPanel`, `CAM_PANEL`). Cameras are drawn by `cameraGlyph()`, facing their beam. Minimize state is in the per-browser prefs (`exMin`, `camMin`). Layout constants (`VIEW`, `LED_Y0/DY`, `STAGE_Y`, `CX`, `CELL_SCALE`) are at the top; slot positions are in `slots()`. Keep label text at 12.5 px or larger. `slots()` defines every clickable slot (id, x/y, `cats`, get/set). `exPanel` is the excitation plot, drawn in SVG. It also draws the cell, the camera readouts, and the cube button.
  - `ui/picker.js`: the part picker with columns pref / all / ours. `accepts()` enforces slot typing: filter slots take `F` with `sub != BS`, dichroic slots take only `BS`.
  - `ui/cubeMenu.js`: the presets menu. Clicking a card links the current acquisition's cube to that preset. **Edit** and **+ New preset** open an inline editor (parts chosen through `ctx.pick`, which wraps `openPicker`). Saving writes `settings/cubes` at once, for everyone.
  - `ui/beamTooltip.js`: the hover and pinned tooltip on beams. Emission passes `{acq, cumulative}`; excitation passes `{kind: 'ex', sources}` with one source per LED (`onExHover` in main.js). Excitation hit paths carry `data-ex` (`led|<key>`, `paddle|<key>`, or an `exCum` key); emission hit paths carry `data-em`.
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
- Fields: `{name, description (the UI "Notes"), schemaVersion: 2, archived, leds[{key,label,spectrumId,paddleId}], cube{exciterId,dichroicId,emitterId}, splitter{dichroicId,bypassTo:'A'|'B',armA{filterId,cameraId},armB{…}}, fluors[{key,enabled}], acquisitions[{name,ledsOn[],cube{exciterId,dichroicId,emitterId,presetId?},intended{A,B}}]}`.
- **Per-acquisition cubes:** each acquisition tab has its own LEDs and cube. The splitter, arm filters, paddles and cameras are shared. `normalizeConfig` copies the legacy `doc.cube` into any acquisition without one, so old configs give the same results. `doc.cube` stays in the document for older copies of the app and is no longer edited.
  - `presetId` links a cube to a shared preset. `effectiveCube(acq, presets)` returns the live preset parts when linked, or the acquisition's own parts when unlinked or when the preset was deleted. Choosing any cube part by hand unlinks (`slots(doc, ai, presets)` setters). A new acquisition copies the current tab's cube.
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
  - `settings/cubes {presets[{id, name, part?, exciterId, dichroicId, emitterId, paddles?}]}`: the shared cube presets. If reading it fails (e.g. rules not deployed), the app uses the built-in presets without writing them.
- `saveConfig(id, content, base, normalize)` normalizes the server copy before the 3-way merge. Without it, fields an older client never wrote (such as acquisition cubes) look like someone else's edit and every first save reports a conflict.
- `firestore.rules` requires sign-in, validates shapes, and forbids deletes. **If you add document fields, update `validConfig` `hasOnly`, or saves will fail.**
- Login: the username is mapped to `<user>@scope.lab` (`USERNAME_DOMAIN`). The user creates accounts by hand, with sign-up disabled.

## Lab parts (`src/data/labParts.js`)
- **`DEFAULT_INVENTORY`** only seeds `settings/inventory` when that document doesn't exist. After go-live, editing this array does NOT change the live list. Users edit it with ★ in the picker, or you write the Firestore document.
- **`CUBE_PRESETS`** (names) only seeds `settings/cubes` (IDs) when that document doesn't exist. After that, presets are edited in the cube menu. When a preset has `paddles`, loading it also puts each exciter on the LED with the largest normalized overlap (`applyPreset` in main.js); later edits to the preset change only the cube parts. `matchPreset(cube, presets)` drives the cube label: the linked preset's name, else a preset with identical parts.
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
- **Cube dichroic:** an empty slot reflects nothing, so excitation goes straight through and never reaches the sample. `simulate` returns `acquisitions[i].cubeLeak {passed, arriving, frac, peakNm}`, the excitation the dichroic transmits.
  - The diagram draws that light continuing to a beam dump.
  - It shows the WARNING panel (`leakPanel`) above the cell when `frac` ≥ the slider threshold. The threshold is a per-browser pref (`leakThreshold`), default 5%, range 0–25%.
- **FRET:** the optional config field `fret {on, donor, acceptor, efficiency 0–1}` is written only once someone uses the controls; `fretOf()` in schema.js supplies the defaults.
  - Model (`simulate`, `input.fret`): the donor emits (1 − E)·A_D·Q_D, and the acceptor emits (A_A + E·A_D)·Q_A. This is donor quenching plus sensitized emission (Lakowicz 2006 ch. 13; Zal & Gascoigne 2004, Biophys J 86:3923). It assumes 1:1 stoichiometry.
  - `perFluor[i].emitted` and `emitted0` give the photon counts with and without FRET; `emittedBy` and `emittedByNoFret` give the matching spectra. `signal` uses `emitted`. The `collection` bars are unchanged by FRET.
  - UI: the switch and donor/acceptor selects sit above the cell, and the vertical E bar sits left of the cell, no taller than the cell, clear of the Camera 2 graph (`fretControls`). Camera graphs draw the no-FRET light as a grey outline (`.cam-orig`).
  - Rules allow `fret` as an optional map.
- Excitation spectra are normalized by their maximum **within 360–700 nm** (`normalizePeakInRange`, `EX_NORM_RANGE`), both in the model and in every plot. Curves may exceed 1 outside that window; the diagram clips them.
- Camera graphs show one bar per included fluorophore, giving the fraction of its emitted light that reaches that camera (`result.fluors[i].collection[cam]`). They deliberately do not show a composition split.
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
- **Rules and code ship together:** when a change needs new Firestore rules (new fields, deletes), deploy the rules *before* pushing the code, or old rules will reject the new writes.
- **Live deployment:** https://trevvo.github.io/Microscope-Optics/ (GitHub repo `Trevvo/Microscope-Optics`; Firebase project `microscope-optics`). Pushing to `main` redeploys.
- FPbase's data license was never confirmed (see `public/data/fpbase/ATTRIBUTION.md`).
