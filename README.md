# Light-path simulator

A web app that models the lab's widefield scope as a chain of spectral elements, laid out right to left:

```
SpectraX LEDs (+ paddle filters) → filter cube exciter → cube dichroic (R) → sample
  → cube dichroic (T) → cube emitter → Gemini dichroic (T → Camera 1, R → Camera 2) → arm filter → camera QE
```

For each sequential acquisition (a set of LEDs switched on), it shows what fraction of each camera's signal comes from each fluorophore. Every fluorophore is treated as equally bright at its excitation peak; extinction coefficient and quantum yield are not used. Configurations are shared: anyone signed in can edit them, and every save is versioned.

Hosting is GitHub Pages (static). Firebase handles login and stores configs, revisions and custom spectra. Filter, LED, camera and fluorophore spectra come from an [FPbase](https://www.fpbase.org) snapshot bundled with the site, because FPbase's API doesn't allow browser (CORS) requests.

## Using it

The whole screen is the light path.

- **Title (top left):** click it to rename. The ▾ next to it opens the configuration menu: switch configs, New, Duplicate, Archive, Save version, History/restore, and sign out. **Notes** under the title is a free-text box saved with the config.
- **Acquisition tabs (top centre):** each tab is one exposure. Click the active tab's name to rename it; **+** adds a copy. Turn LEDs on and off with the switches on the SpectraX box.
- **Click any circle** to choose a part. The search is fuzzy (e.g. `59022bs`, `ET525/50`, `T565lpxr`, `ORCA-Flash4.0`). The preview shows the highlighted part acting on the light that actually arrives at that slot. Choose **None** to empty a slot, or **Custom spectrum…** to paste a measured curve, which is shared with everyone.
- **Part names:** filters are titled by their measured passband(s), "center ± half-width" (e.g. `635 ± 12`). Dichroics are titled by their 50% cutoff edge(s) (e.g. `658 nm`, `410/495/574/654 nm`). The part name follows in smaller text, e.g. "(Semrock FF01-635/18)". Values are computed from each spectrum (FWHM at 50% of peak transmission), so they can differ from the nominal part number. Semrock's "/18", for instance, is a guaranteed minimum bandwidth; FF01-635/18 measures 635 ± 12. You can search by either form: `635/18`, `635±12`, `652 dichroic` or `FF652`.
- **Preferred paddle filters:** when you choose a SpectraX LED's paddle filter, an extra **Preferred** column comes first, listing the lab's usual excitation filters for that LED. They are UV-Violet 378/52, Blue 438/29, Cyan-Teal 474/27 and 509/22, Green-Yellow 578/21 and 554/23, Red-Far Red 635/18 and 660/30, and NIR 730/40 (`PADDLE_PREFERRED` in `src/data/labParts.js`).
- **Picker columns:** the left column searches everything in FPbase; the right column searches **★ our filters**, the lab's shared inventory. Click ☆/★ on any row to add or remove a part. Filter slots (paddles, exciter, emitter, arm filters) only list filters, and dichroic slots only list dichroics.
- **Premade cubes:** the cube button inside the filter cube loads a whole cube.
  - **Triple** (Semrock LED-CFP/YFP/mCherry-3X3M-A-OFF): dichroic FF459/526/596-Di01 and emitter FF01-475/543/702 in the cube.
  - **Quad** (Semrock LED-DA/FI/TR/Cy5-4X4M-B-OFF): dichroic FF409/493/573/652-Di02 and emitter FF01-432/515/595/730 in the cube.
  - For both, the single-band exciters go on the SpectraX paddles (each on the LED it overlaps most), and the cube exciter slot is left empty.
  - **POS-G, POS-A, POS-T, POS-C** fill exciter, dichroic and emitter.
  - The loaded cube's name appears under the button.
- **The cell on the stage:** click it to add or remove fluorophores (any FPbase protein or dye). Its dots glow in proportion to how strongly each fluorophore is excited in the current acquisition.
- **Excitation at the sample** (the panel beside the cell; click its header to minimise):
  - dashed curves are each fluorophore's excitation spectrum;
  - filled curves are each LED's light arriving at the sample;
  - FPbase-style solid lines at each LED's peak are labelled with the % of each fluorophore's maximum excitation.
- **Hover any emission beam** to see the light at that point as a stacked spectrum by fluorophore, plus how much of the emitted light remains. **Click the beam to pin** the tooltip, then move over its chart to read the fluorophore mix at each wavelength.
- **"Camera 1 / 2 sees"** readouts beside the cameras give each fluorophore's share of that camera's signal in the current acquisition, and the signal relative to the brightest camera × acquisition.
- **Detailed graphs** (top right, with a warning count) opens a drawer containing:
  - composition bars with target/purity;
  - a crosstalk matrix;
  - an efficiency table;
  - warnings;
  - overview plots and the spectrum after every element.

Edits save automatically (after about 1 s of inactivity, and at least every 5 s while you keep editing). If someone else changes the config you have open, it reloads (when you have no unsaved edits) or shows a banner letting you choose whose version to keep.

## Model assumptions

These are also shown in the app under "Model & assumptions":

- Every LED switched on in an acquisition delivers equal integrated optical power. Light is converted to photon flux (∝ P·λ).
- Dichroics are lossless: R = 1 − T. Gemini: transmitted → Camera 1, reflected → Camera 2. An empty slot has T = 1, and a missing camera counts as QE = 1.
- All fluorophores are equally bright (EC and QY not used). Absorption ∝ ∫ photon flux × peak-normalized excitation spectrum; emission follows the area-normalized emission spectrum.
- 1-photon excitation far from saturation, with no bleaching or FRET. Objective, tube lens and NA are treated as flat across wavelength.
- **SPECTRA X LEDs use the unfiltered source spectra.** The six slots are the current SPECTRA X sources: UV-Violet, Blue, Cyan-Teal, Green-Yellow, Red-Far Red and NIR. They are seeded with FPbase's `Spectra X23 *` spectra, which match Lumencor's published unfiltered output (Operation Manual 57-10039 Rev A, Figure 7): peak-normalized r ≥ 0.998 and peaks within 1 nm. `scripts/verify_spectrax_unfiltered.py` downloads the manual, digitizes the figure and repeats the check. The paddle slots hold each source's bandpass filter; Lumencor's defaults are in the picker as `Lumencor 377/54x`, `438/29x`, `475/28x` (or `510/25x` for teal), `555/28x` (or `575/25x` for yellow), `635/22x` and `730/40x`.
- FPbase's older `SpectraX *` entries are **filtered** outputs; their widths match the standard bandpass filters. They are marked *filtered output* in the picker, and their spurious near-IR noise tail has been removed (see `clean_led` in `scripts/fetch_fpbase.py`). Configs saved with them are migrated to the unfiltered sources automatically.
- Lumencor's figure also gives absolute power (about 720, 770, 600, 1680, 430 and 360 mW for U/B/C/G/R/N unfiltered). The model deliberately ignores this and uses equal power per LED.

## Lab parts: how the list was mapped

The lab's filter list and the cube presets live in `src/data/labParts.js`. The Semrock cube compositions come from FPbase's "Semrock Filter Sets" microscope:
- **LED-CFP/YFP/mCherry-3X3M-A:**
  - exciters FF02-438/24, FF01-509/22, FF01-578/21;
  - dichroic FF459/526/596-Di01;
  - emitters FF01-482/25, FF01-544/24, FF02-641/75 (the lab's cube holds the multiband FF01-475/543/702).
- **LED-DA/FI/TR/Cy5-4X4M-B:**
  - exciters FF01-378/52, FF01-474/27, FF01-554/23, FF01-635/18;
  - dichroic FF409/493/573/652-Di02;
  - emitters FF01-432/36, FF01-515/30, FF01-595/31, FF01-698/70 (the lab's cube holds the multiband FF01-432/515/595/730).

Some mappings are judgement calls; fix them with ★ in the picker, or by editing the file:
- **"554/24"** is assumed to be the triple set's **544/24** emitter. The only 554/24 in FPbase is one band of a Leica quad exciter.
- **575/25, 730/40, 438/29, 510/25, 555/28** map to the **Lumencor** SPECTRA X paddle filters. Other vendors make parts with the same numbers.
- **"532 dichroic"** maps to **Semrock DI03-R532** (measured edge 538 nm). Chroma RT532rdc is the alternative.
- **"560 dichroic"** maps to **FF560-FDi01** (image-splitting). FF560-Di01 is the cube version.
- **545/40, 555/25, 667/30** map to **Chroma ET** parts, the only matches.
- **"699 dichroic" (Semrock FF699-FDi01)** is not in FPbase. Its spectrum comes from Semrock's SearchLight service (fetched by `scripts/fetch_fpbase.py`).
- **POS-A's "quad cube emission"** is the quad cube's multiband emitter, FF01-432/515/595/730.

## Development

```bash
npm install
npm run dev        # http://localhost:5173 — local mode (localStorage, no login) until Firebase is configured
npm test           # physics unit tests (vitest)
npm run build
npm run fetch-fpbase   # refresh the FPbase snapshot (Python 3 + numpy + requests; ~5 min, resumable)
```

Layout: `src/physics/` holds the pure spectral model (tested in `tests/physics.test.js`). `src/resolve.js` maps configs to physics input and generates warnings. `src/ui/` holds the diagram (cell, excitation panel, camera readouts), beam tooltip, part picker, fluorophore popover, top bar and details drawer. `src/backend.js` contains the Firebase and localStorage backends.

## One-time setup: Firebase

1. Create a project at <https://console.firebase.google.com>. Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Authentication → Settings → User actions → uncheck "Enable create (sign-up)".** This stops people creating their own accounts.
4. **Authentication → Users → Add user** for each person. Use the email `<username>@scope.lab` (the suffix is `USERNAME_DOMAIN` in `src/firebase-config.js`) and a password you choose. On the login screen people type only the username.
5. **Build → Firestore Database → Create database** (production mode, any region).
6. Deploy the security rules (only signed-in users can read or write; nothing can be deleted; revisions are append-only):
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project <your-project-id>
   ```
   Alternatively, paste the contents of `firestore.rules` into **Firestore → Rules** and publish.
7. **Project settings → General → Your apps → Web app (`</>`)**, register an app, and copy the config into `src/firebase-config.js`. These values are identifiers, not secrets; access is enforced by the rules and the sign-in.
8. **Authentication → Settings → Authorized domains → Add** `<your-github-username>.github.io`.

Security level: this keeps out casual visitors, as intended. Anyone with an account can edit or archive any config, but every save is recoverable from History. For stronger protection, add Firebase App Check.

## One-time setup: GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Each push to `main` runs `.github/workflows/deploy.yml`, which tests, builds (with the base path set to `/<repo-name>/`) and deploys to `https://<user>.github.io/<repo-name>/`.

## Data attribution

Spectra and fluorophore properties are from FPbase (Lambert, *Nat. Methods* 2019). See `public/data/fpbase/ATTRIBUTION.md`. Check FPbase's current terms before making the site public.
