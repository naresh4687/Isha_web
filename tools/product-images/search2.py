import json, re, sys, time, urllib.parse, urllib.request, os, html
UA = "AnvayaDemoStore/1.0 (image sourcing for a demo shop; https://github.com/naresh4687/Isha_web)"
OK = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? [0-9.]+( [a-z]+)?|cc by(-sa)?)$", re.I)
ALLOWED_HOSTS = {"commons.wikimedia.org", "upload.wikimedia.org", "api.openverse.org", "live.staticflickr.com", "pd.w.org"}

def get(url):
    if urllib.parse.urlparse(url).netloc not in ALLOWED_HOSTS and not urllib.parse.urlparse(url).netloc.endswith(".staticflickr.com"):
        raise SystemExit(f"refusing to fetch from non-allow-listed host: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return r.read()
        except Exception as e:
            time.sleep(2 + 3 * i); last = e
    raise last
def strip(s): return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()
def search(q, n=10):
    p = {"action": "query", "format": "json", "generator": "search", "gsrsearch": f"{q} filetype:bitmap", "gsrnamespace": 6,
         "gsrlimit": n, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 220}
    d = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)))
    out = []
    for pg in sorted(d.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 0)):
        ii = pg["imageinfo"][0]; m = ii.get("extmetadata", {})
        lic = strip(m.get("LicenseShortName", {}).get("value"))
        if not OK.match(lic) or ii["mime"] not in ("image/jpeg", "image/png", "image/webp") or min(ii["width"], ii["height"]) < 700: continue
        out.append({"title": pg["title"], "license": lic, "licenseUrl": strip(m.get("LicenseUrl", {}).get("value")),
                    "artist": strip(m.get("Artist", {}).get("value")), "page": ii["descriptionurl"], "url": ii["url"],
                    "thumb": ii["thumburl"], "w": ii["width"], "h": ii["height"]})
    return out
exec(open("queries2.py").read())
res = json.load(open("cands2.json")) if os.path.exists("cands2.json") else {}
for slug, qs in Q.items():
    if slug in res: continue
    seen, cands = set(), []
    for q in qs:
        for c in search(q):
            if c["title"] not in seen: seen.add(c["title"]); cands.append(c)
        time.sleep(0.5)
    cands = cands[:12]
    os.makedirs(f"thumbs2/{slug}", exist_ok=True)
    for i, c in enumerate(cands):
        open(f"thumbs2/{slug}/{i}.jpg", "wb").write(get(c["thumb"])); time.sleep(0.2)
    res[slug] = cands
    json.dump(res, open("cands2.json", "w"), indent=1)
    print(slug, len(cands), flush=True)
