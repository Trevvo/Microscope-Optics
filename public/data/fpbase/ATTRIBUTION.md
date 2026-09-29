# Spectra source

All spectra and fluorophore properties (extinction coefficient, quantum yield) are from [FPbase](https://www.fpbase.org), snapshot fetched 2026-09-29 via its GraphQL API.

Lambert, T.J. FPbase: a community-editable fluorescent protein database. *Nature Methods* 16, 277–278 (2019). https://doi.org/10.1038/s41592-019-0352-8

Spectra were linearly resampled to 300–1000 nm at 1 nm and quantised to 1e-5. Check FPbase's current terms of use before redistributing this snapshot.

**SPECTRA X sources:** the app seeds the LED slots with FPbase's `Spectra X23 *` spectra, which match Lumencor's published *unfiltered* output (SPECTRA X Operation Manual 57-10039 Rev A, Figure 7; r ≥ 0.998, see scripts/verify_spectrax_unfiltered.py).

**Modified spectra:** FPbase's older `SpectraX *` entries are *filtered* outputs and also contain a noise baseline and a large spurious tail above ~850 nm. They were cleaned (zeroed above 800 nm, baseline subtracted, trimmed to the main emission lobe; see `clean_led` in scripts/fetch_fpbase.py) and are flagged as filtered in the picker.

**Added from Semrock:** Semrock FF699-FDi01 (not in FPbase) from Semrock's SearchLight spectra service (searchlight.idex-hs.com).
