#!/usr/bin/env python3
"""Check FPbase's "Spectra X23 *" LED spectra against Lumencor's published
unfiltered SPECTRA X output (Operation Manual 57-10039 Rev A, Figure 7, p16).

The figure is a raster plot, so each coloured curve is digitised (axes are
calibrated from the 400/500/600/700 nm and 10–50 mW/nm tick marks) and compared
with the FPbase spectrum after peak normalisation.

Result when written (2026-09-29): r ≥ 0.998 for all six sources, peaks within
1 nm (Cyan-Teal's two lobes at 473/494 nm are near-equal, so its argmax flips).
The app therefore uses the FPbase X23 spectra as the unfiltered LED outputs.

Needs: pdfplumber, numpy, scipy, requests, and scripts/.cache/raw from fetch_fpbase.py.
Usage: python3 scripts/verify_spectrax_unfiltered.py
"""
import io
import json
from pathlib import Path

import numpy as np
import pdfplumber
import requests
from scipy import ndimage

MANUAL = "https://cms.lumencor.com/system/uploads/fae/file/asset/196/57-10039_SPECTRA_X_Manual_noTUV.pdf"
RAW = Path(__file__).resolve().parent / ".cache" / "raw"
FPBASE = {"U": "8813", "B": "8814", "C": "8815", "G": "8816", "R": "8817", "N": "8818"}
PEAKS = {"U": 382, "B": 437, "C": 494, "G": 560, "R": 633, "N": 731}  # where to sample each curve's colour

# Frame calibration at 600 dpi of the cropped figure, measured from its tick marks:
# x: 400/500/600/700 nm ticks at 831.5/1709.5/2587.5/3465.5 px → 350 nm at 389.5, 800 nm at 4343.5
# y: 0 mW/nm at 1229.5 px, 60 mW/nm at 153.5 px
LEFT, RIGHT, TOP, BOT = 389.5, 4343.5, 153.5, 1229.5


def figure():
    pdf = pdfplumber.open(io.BytesIO(requests.get(MANUAL, timeout=60).content))
    img = pdf.pages[15].crop((36, 172, 576, 350)).to_image(resolution=600).original
    return np.asarray(img.convert("RGB")).astype(int)


def digitise(a, colour):
    m = np.sqrt(((a - colour) ** 2).sum(axis=2)) < 60
    m[: int(TOP) + 6] = m[int(BOT) - 3 :] = False
    m[:, : int(LEFT) + 5] = m[:, int(RIGHT) - 3 :] = False
    lab, n = ndimage.label(m)
    keep = lab == (np.argmax(ndimage.sum(m, lab, range(1, n + 1))) + 1)  # drop the letter labels
    xs, ys = [], []
    for x in range(int(LEFT) + 5, int(RIGHT) - 3):
        r = np.where(keep[:, x])[0]
        if len(r):
            xs.append(350 + (x - LEFT) / (RIGHT - LEFT) * 450)
            ys.append((BOT - r.mean()) / (BOT - TOP) * 60)
    grid = np.arange(350, 801)
    return grid, np.clip(np.interp(grid, xs, ys, left=0, right=0), 0, None)


def main():
    a = figure()
    for k, fid in FPBASE.items():
        x = int(round(LEFT + (PEAKS[k] - 350) / 450 * (RIGHT - LEFT)))
        col = a[int(TOP) + 8 : int(BOT) - 8, x]
        colour = col[np.argmax(col.max(axis=1) - col.min(axis=1))]
        grid, lum = digitise(a, colour)
        raw = np.array(json.loads((RAW / f"{fid}.json").read_text()))
        raw = raw[np.argsort(raw[:, 0])]
        fp = np.interp(grid, raw[:, 0], raw[:, 1], left=0, right=0)
        r = np.corrcoef(fp / fp.max(), lum / lum.max())[0, 1]
        print(f"{k}: Lumencor peak {grid[lum.argmax()]} nm ({lum.max():.1f} mW/nm, ∫ {lum.sum():.0f} mW) · "
              f"FPbase X23 #{fid} peak {grid[fp.argmax()]} nm · r = {r:.3f}")


if __name__ == "__main__":
    main()
