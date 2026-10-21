"""Fetch picked Commons files, crop to square, write 400/800 px WebP with content hashes, emit manifest.
Usage: python3 -I build.py <out_dir> [--preview]"""
import hashlib, html, io, json, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "AnvayaDemoStore/1.0 (image sourcing for a demo shop; https://github.com/naresh4687/Isha_web)"
exec(open(os.path.join(HERE, "picks.py")).read())   # P
exec(open(os.path.join(HERE, "alts.py")).read())    # ALT, GRAVITY, UNRESOLVED
cands = json.load(open(os.path.join(HERE, "cands.json")))
cands.update({"2:" + k: v for k, v in json.load(open(os.path.join(HERE, "cands2.json"))).items()})
cands.update({"ov:" + k: v for k, v in json.load(open(os.path.join(HERE, "ov_cands.json"))).items()})
out_dir = sys.argv[1]; preview = "--preview" in sys.argv
os.makedirs(os.path.join(HERE, "cache"), exist_ok=True)

# Network access is limited to these hosts (Commons API/files, Openverse API, Flickr and WordPress photo files).
ALLOWED_HOSTS = {"commons.wikimedia.org", "upload.wikimedia.org", "api.openverse.org", "live.staticflickr.com",
                 "farm1.staticflickr.com", "farm2.staticflickr.com", "farm4.staticflickr.com", "farm5.staticflickr.com",
                 "farm6.staticflickr.com", "farm8.staticflickr.com", "farm9.staticflickr.com", "pd.w.org"}

def get(url):
    host = urllib.parse.urlparse(url).netloc
    if host not in ALLOWED_HOSTS:
        raise SystemExit(f"refusing to fetch from non-allow-listed host {host!r}: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return r.read()
        except Exception as e:
            last = e; time.sleep(3 + 5 * i)
    raise last

INSTITUTIONS = {"Walters": "Walters Art Museum", "Cleveland Museum of Art": "Cleveland Museum of Art",
                "DPLA": "Digital Public Library of America contributor", "(AM ": "Auckland Museum"}

def strip(s): return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()

def info(title):
    width = WIDTH.get(title, 1200)
    p = {"action": "query", "format": "json", "titles": title, "prop": "imageinfo",
         "iiprop": "url|size|mime|sha1|extmetadata", "iiurlwidth": width}
    page = next(iter(json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)))["query"]["pages"].values()))
    return page["imageinfo"][0]

def pad(img):
    """Fit the whole image in a square by extending its own edge rows/columns (for long, thin subjects)."""
    w, h = img.size; s = max(w, h); out = Image.new("RGB", (s, s))
    x0, y0 = (s - w) // 2, (s - h) // 2
    if w >= h:
        out.paste(img.crop((0, 0, w, 2)).resize((w, y0 + 1)), (0, 0))
        out.paste(img.crop((0, h - 2, w, h)).resize((w, s - y0 - h + 1)), (0, y0 + h - 1))
    else:
        out.paste(img.crop((0, 0, 2, h)).resize((x0 + 1, h)), (0, 0))
        out.paste(img.crop((w - 2, 0, w, h)).resize((s - x0 - w + 1, h)), (x0 + w - 1, 0))
    out.paste(img, (x0, y0)); return out

def square(img, g):
    w, h = img.size; s = min(w, h); fx, fy = g
    x = round(min(max(fx * w - s / 2, 0), w - s)); y = round(min(max(fy * h - s / 2, 0), h - s))
    return img.crop((x, y, x + s, y + s))

CACHED = [""]

def fit_for(img):
    """'contain' for isolated product shots (border mostly plain light neutral), else 'cover' (lifestyle/texture)."""
    px = img.resize((64, 64)).load()
    border = [px[x, y] for x in range(64) for y in (0, 1, 62, 63)] + [px[x, y] for y in range(64) for x in (0, 1, 62, 63)]
    plain = sum(1 for r, g, b in border if 0.299 * r + 0.587 * g + 0.114 * b > 185 and max(r, g, b) - min(r, g, b) < 28)
    return "contain" if plain / len(border) >= 0.7 else "cover"

def commons_source(title):
    key = hashlib.sha1(title.encode()).hexdigest()[:12]
    cache = os.path.join(HERE, "cache", key)
    if not os.path.exists(cache + ".json"):
        ii = info(title); data = get(ii["thumburl"]); time.sleep(0.5)
        open(cache + ".bin", "wb").write(data); json.dump(ii, open(cache + ".json", "w"))
    ii = json.load(open(cache + ".json")); m = ii.get("extmetadata", {})
    lic = strip(m.get("LicenseShortName", {}).get("value"))
    assert re.match(r"^(cc0|public domain|cc by(-sa)? [0-9.]+)$", lic, re.I), (title, lic)
    artist = strip(m.get("Artist", {}).get("value"))
    author = (strip(m.get("Attribution", {}).get("value"))
              or (artist if artist and "unknown" not in artist.lower() else "")
              or next((v for k, v in INSTITUTIONS.items() if k in title), "")
              or "Wikimedia Commons contributor")
    CACHED[:] = [cache + ".bin"]
    return open(cache + ".bin", "rb").read(), {
        "title": title, "page": ii["descriptionurl"], "original": ii["url"], "sha1": ii["sha1"], "site": "Wikimedia Commons",
        "author": re.sub(r"\s+", " ", author)[:160], "license": lic, "licenseUrl": strip(m.get("LicenseUrl", {}).get("value")) or None}

OV_LICENCE = {"cc0": "CC0", "pdm": "Public domain", "by": "CC BY", "by-sa": "CC BY-SA"}

def openverse_source(c):
    """A candidate found through Openverse (licence metadata from the Openverse API); the file comes from its host."""
    key = "ov-" + c["id"]
    cache = os.path.join(HERE, "cache", key)
    if not os.path.exists(cache + ".bin"):
        open(cache + ".bin", "wb").write(get(c["url"])); time.sleep(0.5)
    lic = OV_LICENCE[c["license"]] + ("" if c["license"] in ("cc0", "pdm") else f" {c['license_version']}")
    site = {"flickr": "Flickr", "wordpress": "WordPress Photo Directory", "wikimedia": "Wikimedia Commons"}.get(c["source"], c["source"])
    CACHED[:] = [cache + ".bin"]
    return "ov:" + c["id"], open(cache + ".bin", "rb").read(), {
        "title": c["title"], "page": c["foreign_landing_url"], "original": c["url"], "site": site, "via": "Openverse",
        "author": c["creator"] or f"{site} contributor", "license": lic, "licenseUrl": c["license_url"]}

products, report, SEEN = {}, [], {}
titles = {}
for line in open(os.path.join(HERE, "../../server/seed/catalog.ts")):
    m = re.search(r"title: '((?:[^'\\]|\\.)*)'", line)
    if m:
        t = m.group(1).replace("\\'", "'")
        titles[re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", re.sub(r"['’]", "", t.lower())))] = t

for slug, picks in P.items():
    imgs = []
    for n, (row, idx) in enumerate(picks):
        c = cands[row][idx]
        if row.startswith("ov:"):
            title, data, src = openverse_source(c)
        else:
            title = c["title"]; data, src = commons_source(title)
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        sq = pad(img) if title in PAD else square(img, GRAVITY.get(title, (0.5, 0.5)))
        if min(sq.size) < 600: report.append(f"LOW-RES {slug} {title} {sq.size}")
        files = {}
        for w in (400, 800):
            buf = io.BytesIO(); sq.resize((w, w), Image.LANCZOS).save(buf, "WEBP", quality=80, method=6); files[w] = buf.getvalue()
        h = hashlib.sha256(files[800]).hexdigest()[:10]
        if h in SEEN: raise SystemExit(f"duplicate image: {slug} #{n} is identical to {SEEN[h]}")
        SEEN[h] = f"{slug} #{n}"
        rel = f"{slug}/{n}-{h}"
        if not preview:
            os.makedirs(os.path.join(out_dir, slug), exist_ok=True)
            for w, b in files.items():  # write-then-rename so an interrupted run never leaves a partial file
                dest = os.path.join(out_dir, f"{rel}-{w}.webp"); tmp = dest + ".part"
                open(tmp, "wb").write(b); os.replace(tmp, dest)
        else:
            os.makedirs(os.path.join(HERE, "preview"), exist_ok=True)
            sq.resize((200, 200)).save(os.path.join(HERE, "preview", f"{slug}__{n}.jpg"))
        src["retrieved"] = time.strftime("%Y-%m-%d", time.gmtime(os.path.getmtime(CACHED[0])))
        src["modifications"] = ("Padded to square" if title in PAD else "Cropped to square") + " and resized; converted to WebP."
        imgs.append({"file": rel, "alt": ALT[title], "width": 800, "height": 800, "fit": fit_for(sq),
                     "bytes": {"400": len(files[400]), "800": len(files[800])}, "source": src})
    products[slug] = {"title": titles[slug], "images": imgs}

manifest = {
  "version": 1,
  "generated": time.strftime("%Y-%m-%d"),
  "policy": ("Representative photographs from Wikimedia Commons under licences that permit commercial reuse with attribution "
             "(Public domain, CC0, CC BY, CC BY-SA). They illustrate the kind of item; they are not photos of the exact demo products. "
             "Files are stored locally (no hotlinking) as <file>-400.webp and <file>-800.webp. CC BY-SA adaptations (crops) are "
             "shared under the same licence as their source."),
  "products": products,
  "unresolved": {s: {"title": titles[s], "reason": r} for s, r in UNRESOLVED.items()},
}
assert not set(products) & set(UNRESOLVED), set(products) & set(UNRESOLVED)
assert set(products) | set(UNRESOLVED) == set(titles), set(titles) - set(products) - set(UNRESOLVED)
if not preview:
    tmp = os.path.join(out_dir, "manifest.json.part")
    json.dump(manifest, open(tmp, "w"), indent=1, ensure_ascii=False); os.replace(tmp, os.path.join(out_dir, "manifest.json"))
print(f"{len(products)} products, {sum(len(p['images']) for p in products.values())} images, {len(UNRESOLVED)} unresolved")
print("\n".join(report))
