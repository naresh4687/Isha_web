# Product image pipeline

Builds the product photos in `web/public/assets/products/` and their `manifest.json` from
Wikimedia Commons, using only files licensed for commercial reuse (Public domain, CC0, CC BY, CC BY-SA).

1. `search.py` / `search2.py` — query the Commons API with the per-product terms in `queries.py` /
   `queries2.py`; `openverse_search.py` searches Openverse (Flickr, WordPress Photo Directory, commercial-use
   licences only) for the remaining gaps. Each keeps licence-compatible candidates at least 700 px on the
   short side (`cands.json`, `cands2.json`, `ov_cands.json`, plus thumbnails for review).
2. `sheet.py` / `sheet2.py` — contact sheets of the candidates, one row per product, for picking by eye.
3. `picks.py` — the chosen file per product (first = primary). `alts.py` — alt text describing what each
   photo shows, crop overrides, and the products left on illustrations with the reason.
4. `build.py <out_dir>` — downloads a 1200 px rendition through the API, crops (or pads) to square,
   writes `<n>-<hash>-400.webp` and `-800.webp`, and writes the manifest with source, author, licence and
   modifications. `--preview` writes review crops instead.

Run with `python3 -I` (needs Pillow). The server applies the manifest to the `products.images` column at
startup and during seeding (`server/src/modules/catalog/images.ts`); `/image-credits` lists the attributions.

Rules followed when picking: match the product's actual item, no visible brands or trademarks, no
identifiable people, no photos of other books standing in for this store's (fictional) titles.
