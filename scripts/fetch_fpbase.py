#!/usr/bin/env python3
"""Snapshot FPbase spectra + fluorophore metadata into public/data/fpbase/.

FPbase sends no CORS headers, so the browser cannot query it directly; the
site ships a resampled snapshot instead.

Outputs
  public/data/fpbase/index.json   components (lights/filters/cameras) + fluorophores
  public/data/fpbase/s/{id}.json  one spectrum each: {"v": [701 ints 0-100000]} on 300-1000 nm, 1 nm
  public/data/fpbase/ATTRIBUTION.md

Raw GraphQL responses are cached in scripts/.cache/ so an interrupted run resumes.
Usage: python3 scripts/fetch_fpbase.py [--refresh]
"""
import argparse
import datetime as dt
import json
import time
from pathlib import Path

import numpy as np
import requests

URL = "https://www.fpbase.org/graphql/"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "fpbase"
CACHE = Path(__file__).resolve().parent / ".cache"
GRID = np.arange(300, 1001, 1.0)  # must match src/physics/grid.js
BATCH = 50
SCALE = 100000  # 1e-5 resolution so filter blocking down to OD ~5 survives


def gql(query, partial=False):
    """partial=True returns whatever data came back even if some fields errored
    (a few FPbase spectra contain NaN and fail to serialise; those come back null)."""
    for attempt in range(5):
        try:
            r = requests.post(URL, json={"query": query}, timeout=120)
            r.raise_for_status()
            d = r.json()
            if "errors" in d and not (partial and d.get("data")):
                raise RuntimeError(str(d["errors"])[:300])
            return d["data"]
        except Exception as e:  # noqa: BLE001 - retry any transport/GraphQL failure
            wait = 2 ** attempt
            print(f"  retry in {wait}s: {e}")
            time.sleep(wait)
    raise RuntimeError("FPbase query failed repeatedly")


def cached(name, query, refresh):
    p = CACHE / f"{name}.json"
    if p.exists() and not refresh:
        return json.loads(p.read_text())
    d = gql(query)
    p.write_text(json.dumps(d))
    return d


def resample(points):
    """[[λ, v], ...] -> (ints on GRID, [lo, hi] measured range)."""
    a = np.array([p for p in points if p[0] is not None and p[1] is not None], dtype=float).reshape(-1, 2)
    a = a[np.isfinite(a).all(axis=1)]
    if len(a) < 2:
        return [0] * len(GRID), None
    a = a[np.argsort(a[:, 0])]
    lam, v = a[:, 0], a[:, 1]
    if v.max() > 1.5:  # some uploads are in percent
        v = v / 100.0
    v = np.clip(v, 0, 1)
    y = np.interp(GRID, lam, v, left=0.0, right=0.0)
    return np.rint(y * SCALE).astype(int).tolist(), [float(lam.min()), float(lam.max())]


# FPbase's "SpectraX *" spectra are *filtered* outputs (FWHMs match Lumencor's standard bandpass
# filters, e.g. Cyan 462–485 nm ≈ 470/24); the unfiltered sources are "Spectra X23 *"
# (checked against the manual by verify_spectrax_unfiltered.py). They are kept, flagged as filtered.
# They also carry a spectrometer artefact: a noise
# baseline plus a large rising tail above ~850 nm (20–80% of total area; Teal's
# global maximum is at 999 nm). Under the equal-power assumption that tail
# steals most of the "power", so these spectra are cleaned: zero above 800 nm,
# subtract the median baseline away from the peak, keep the contiguous lobe
# around the visible peak (>1% of peak, gaps ≤10 nm). Other sources (broadband
# lamps, white LEDs) are left untouched.
CLEAN_PREFIXES = ("SpectraX ",)


def clean_led(points, cutoff=800, excl=80, thr=0.01, gap=10):
    a = np.asarray(points, dtype=float)
    a = a[np.argsort(a[:, 0])]
    lam, v = a[:, 0], np.clip(a[:, 1], 0, None)
    v[lam > cutoff] = 0
    vis = (lam >= 350) & (lam <= cutoff)
    pk = np.where(vis)[0][v[vis].argmax()]
    far = vis & (np.abs(lam - lam[pk]) > excl)
    v = np.clip(v - (np.median(v[far]) if far.any() else 0), 0, None)
    above = v >= thr * v[pk]
    lo = hi = pk
    miss = 0
    while lo > 0:
        miss = 0 if above[lo - 1] else miss + 1
        if miss > gap:
            break
        lo -= 1
    miss = 0
    while hi < len(v) - 1:
        miss = 0 if above[hi + 1] else miss + 1
        if miss > gap:
            break
        hi += 1
    out = np.zeros_like(v)
    out[lo:hi + 1] = v[lo:hi + 1]
    return np.column_stack([lam, out / out.max()]).tolist()


# Parts missing from FPbase, fetched from Semrock's SearchLight service (the same data Semrock plots).
SEARCHLIGHT = "https://searchlight.idex-hs.com/services/site/"
EXTRA_SEMROCK = {  # SearchLight part name -> (display name, FPbase-style subtype)
    "FF699-FDi01-t1": ("Semrock FF699-FDi01", "BS"),
}


def searchlight(method, payload):
    r = requests.post(SEARCHLIGHT + method, json=payload, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    d = json.loads(r.content.decode("utf-8-sig"))
    if not d.get("Success"):
        raise RuntimeError(d.get("Message"))
    return d["Data"]


def fetch_extras(raw):
    """Download EXTRA_SEMROCK spectra (cached) -> [(id, name, sub)]."""
    out = []
    listing = None
    for part, (name, sub) in EXTRA_SEMROCK.items():
        fid = "sl-" + part
        p = raw / f"{fid}.json"
        if not p.exists():
            listing = listing or searchlight("GetComponentList", {"type": "filter"})
            key = next(c["Key"] for c in listing if c["Name"] == part)
            data = searchlight("GetSpectraForPlotting", {"components": [{"Name": part, "Key": key, "Components": []}], "resolution": 0})
            p.write_text(json.dumps(data[0]["SeriesData"]))
        out.append((fid, name, sub))
    return out


def describe(v, sub, rng):
    """Display label + search keys for a filter, from its measured transmission.

    Bandpass/multiband: "center ± half-width" per passband (FWHM at 50% of the max T).
    Long/shortpass: "LP edge" / "SP edge". Dichroic (BS): the 50% edge(s) where T rises, in nm.
    Mirrored in src/data/describe.js (used for custom spectra); tests/describe.test.js checks parity.
    """
    t = np.asarray(v, dtype=float) / SCALE
    lo_i = max(0, int(np.ceil(rng[0])) - 300)
    hi_i = min(len(GRID) - 1, int(np.floor(rng[1])) - 300)
    if hi_i - lo_i < 5:
        return None, ""
    seg = np.convolve(t[lo_i:hi_i + 1], np.ones(3) / 3, mode="same")  # tame 1-nm ripple
    seg[0], seg[-1] = t[lo_i], t[hi_i]
    lam = GRID[lo_i:hi_i + 1]
    thr = 0.5 * seg.max()
    if thr <= 0:
        return None, ""
    above = seg >= thr
    cross = []  # (λ, rising?)
    for i in range(1, len(seg)):
        if above[i] != above[i - 1]:
            x = lam[i - 1] + (thr - seg[i - 1]) / (seg[i] - seg[i - 1])
            cross.append((float(x), bool(above[i])))
    # drop ripple: a crossing and its reversal closer than 6 nm
    clean = []
    for c in cross:
        if clean and c[1] != clean[-1][1] and c[0] - clean[-1][0] < 6:
            clean.pop()
        else:
            clean.append(c)
    alt = []
    if sub == "BS":
        ups = [round(x) for x, up in clean if up and 350 <= x <= 950]
        downs = [round(x) for x, up in clean if not up and 350 <= x <= 950]
        edges = ups or downs
        if not edges:
            return None, ""
        label = "/".join(map(str, edges)) + (" nm" if ups else " nm SP")
        for e in edges:
            alt += [str(e), f"{e} dichroic", f"{e}nm"]
        return label, " ".join(alt)
    # passbands between rising and falling crossings; open ends -> LP/SP
    bands = []
    start = float(lam[0]) if above[0] else None
    for x, up in clean:
        if up:
            start = x
        elif start is not None:
            bands.append((start, x, start == float(lam[0]), False))
            start = None
    if start is not None:
        bands.append((start, float(lam[-1]), start == float(lam[0]), True))
    bands = [b for b in bands if b[1] - b[0] >= 2]
    # label only the visible/NIR imaging range; out-of-band IR leaks stay in the physics, not the name
    shown = [b for b in bands if 350 <= (b[0] + b[1]) / 2 <= 850] or bands
    bands = shown
    if not bands:
        return None, ""
    parts = []
    for lo, hi, open_lo, open_hi in bands[:6]:
        if open_hi and not open_lo:
            parts.append(f"LP {round(lo)}")
            alt += [str(round(lo)), f"LP{round(lo)}", f"{round(lo)}LP"]
        elif open_lo and not open_hi:
            parts.append(f"SP {round(hi)}")
            alt += [str(round(hi)), f"SP{round(hi)}", f"{round(hi)}SP"]
        else:
            c, w = round((lo + hi) / 2), round(hi - lo)
            h = round((hi - lo) / 2)
            parts.append(f"{c} ± {h}")
            alt += [f"{c}/{w}", f"{c}±{h}", str(c)]
    label = " / ".join(parts) if len(bands) <= 6 else f"multiband ({len(bands)})"
    return label, " ".join(alt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignore cached metadata")
    args = ap.parse_args()
    CACHE.mkdir(exist_ok=True)
    (OUT / "s").mkdir(parents=True, exist_ok=True)

    print("index…", flush=True)
    spectra = cached("spectra", "{ spectra { id category subtype owner { name slug } } }", args.refresh)["spectra"]
    states = cached(
        "states",
        "{ states { id name slug extCoeff qy exMax emMax emhex protein { name slug } spectra { id subtype } } }",
        args.refresh,
    )["states"]
    dyes = cached("dyes", "{ dyes { id name slug extCoeff qy exMax emMax emhex spectra { id subtype } } }", args.refresh)["dyes"]

    # Which spectra we need: all hardware, plus 1P ex/ab/em of fluorophores.
    want = {s["id"]: s for s in spectra if s["category"] in ("L", "F", "C")}
    fluors = []
    for kind, rows in (("protein", states), ("dye", dyes)):
        for st in rows:
            by = {sp["subtype"]: sp["id"] for sp in st["spectra"]}
            ex = by.get("EX") or by.get("AB")
            em = by.get("EM")
            if not (ex and em):
                continue
            if kind == "protein":
                pname = st["protein"]["name"]
                # FPbase state names are "Protein (State)" for multi-state proteins; "default" otherwise.
                name = st["name"] if st["name"].startswith(pname) else pname
            else:
                name = st["name"]
            fluors.append({
                "key": f"{kind[0]}{st['id']}",
                "name": name,
                "kind": kind,
                "ex": ex,
                "em": em,
                "ec": st["extCoeff"],
                "qy": st["qy"],
                "exMax": st["exMax"],
                "emMax": st["emMax"],
                "color": st["emhex"] or None,
            })
            want[ex] = {"id": ex}
            want[em] = {"id": em}

    raw = CACHE / "raw"
    raw.mkdir(exist_ok=True)
    todo = [i for i in want if not (raw / f"{i}.json").exists()]
    print(f"{len(want)} spectra needed, {len(todo)} to download", flush=True)
    for b in range(0, len(todo), BATCH):
        ids = todo[b:b + BATCH]
        q = "{ " + " ".join(f"s{i}: spectrum(id: {i}) {{ data }}" for i in ids) + " }"
        d = gql(q, partial=True)
        for i in ids:
            rec = d.get(f"s{i}")
            (raw / f"{i}.json").write_text(json.dumps(rec["data"] if rec else None))
        print(f"  {min(b + BATCH, len(todo))}/{len(todo)}", flush=True)
        time.sleep(0.5)

    ranges = {}
    cleaned = set()
    for i in want:
        pts = json.loads((raw / f"{i}.json").read_text())
        if not pts:
            continue
        meta = want[i]
        if meta.get("category") == "L" and meta["owner"]["name"].startswith(CLEAN_PREFIXES):
            pts = clean_led(pts)
            cleaned.add(i)
        v, rng = resample(pts)
        if not any(v):  # entirely outside the grid
            continue
        (OUT / "s" / f"{i}.json").write_text(json.dumps({"v": v}, separators=(",", ":")))
        ranges[i] = rng

    extras = fetch_extras(raw)
    for fid, _, _ in extras:
        v, rng = resample(json.loads((raw / f"{fid}.json").read_text()))
        (OUT / "s" / f"{fid}.json").write_text(json.dumps({"v": v}, separators=(",", ":")))
        ranges[fid] = rng

    have = {p.stem for p in (OUT / "s").glob("*.json")}
    components = [
        {
            "id": s["id"],
            "name": s["owner"]["name"],
            "cat": s["category"],
            "sub": s["subtype"],
            "range": ranges.get(s["id"]),
            **({"cleaned": True, "filtered": True} if s["id"] in cleaned else {}),
        }
        for s in spectra
        if s["category"] in ("L", "F", "C") and s["id"] in have
    ]
    components += [{"id": fid, "name": name, "cat": "F", "sub": sub, "range": ranges[fid], "source": "Semrock SearchLight"}
                   for fid, name, sub in extras]
    for c in components:
        if c["cat"] == "F" and c["range"]:
            v = json.loads((OUT / "s" / f"{c['id']}.json").read_text())["v"]
            c["label"], c["alt"] = describe(v, c["sub"], c["range"])
    fluors = [f for f in fluors if f["ex"] in have and f["em"] in have]
    fluors.sort(key=lambda f: f["name"].lower())
    components.sort(key=lambda c: c["name"].lower())
    fetched = dt.date.today().isoformat()
    index = {"fetched": fetched, "grid": [300, 1000, 1], "scale": SCALE, "components": components, "fluors": fluors}
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (OUT / "ATTRIBUTION.md").write_text(
        f"# Spectra source\n\nAll spectra and fluorophore properties (extinction coefficient, quantum yield) are from "
        f"[FPbase](https://www.fpbase.org), snapshot fetched {fetched} via its GraphQL API.\n\n"
        "Lambert, T.J. FPbase: a community-editable fluorescent protein database. "
        "*Nature Methods* 16, 277–278 (2019). https://doi.org/10.1038/s41592-019-0352-8\n\n"
        "Spectra were linearly resampled to 300–1000 nm at 1 nm and quantised to 1e-5. "
        "Check FPbase's current terms of use before redistributing this snapshot.\n\n"
        "**SPECTRA X sources:** the app seeds the LED slots with FPbase's `Spectra X23 *` spectra, which match "
        "Lumencor's published *unfiltered* output (SPECTRA X Operation Manual 57-10039 Rev A, Figure 7; "
        "r ≥ 0.998, see scripts/verify_spectrax_unfiltered.py).\n\n"
        "**Modified spectra:** FPbase's older `SpectraX *` entries are *filtered* outputs and also contain a "
        "noise baseline and a large spurious tail above ~850 nm. They were cleaned (zeroed above 800 nm, "
        "baseline subtracted, trimmed to the main emission lobe; see `clean_led` in scripts/fetch_fpbase.py) "
        "and are flagged as filtered in the picker.\n\n"
        "**Added from Semrock:** " + ", ".join(n for n, _ in EXTRA_SEMROCK.values()) +
        " (not in FPbase) from Semrock's SearchLight spectra service (searchlight.idex-hs.com).\n"
    )
    print(f"done: {len(components)} components, {len(fluors)} fluorophores")


if __name__ == "__main__":
    main()
