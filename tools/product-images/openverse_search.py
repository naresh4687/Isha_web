"""Search Openverse (commercial-use licences only) for products still without a photo.
Writes ov_cands.json and review thumbnails in thumbs3/. Usage: python3 -I openverse_search.py"""
import io, json, os, time, urllib.parse, urllib.request
from PIL import Image

UA = "AnvayaDemoStore/1.0 (image sourcing for a demo shop; https://github.com/naresh4687/Isha_web)"
Q = {
 "rudraksha-and-sandalwood-bracelet": ["sandalwood bead bracelet", "rudraksha bracelet"],
 "panchamukhi-bead-set-for-children": ["rudraksha bead", "rudraksha seed"],
 "pure-camphor-tablets": ["camphor tablets", "camphor"],
 "engraved-copper-altar-plate": ["copper plate", "puja thali"],
 "rectangular-yoga-bolster": ["yoga bolster", "meditation bolster"],
 "organic-cotton-yoga-pants": ["yoga pants folded", "cotton trousers"],
 "handloom-cotton-cushion-cover": ["cushion cover", "cotton cushion"],
 "braided-jute-rug": ["jute rug", "braided rug"],
 "carved-wooden-incense-holder": ["incense holder", "incense stick holder wooden"],
}
OK = {"cc0", "pdm", "by", "by-sa"}

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40) as r: return r.read()
        except Exception as e:
            last = e; time.sleep(3 + 4 * i)
    raise last

out = json.load(open("ov_cands.json")) if os.path.exists("ov_cands.json") else {}
for slug, qs in Q.items():
    if slug in out: continue
    seen, cands = set(), []
    for q in qs:
        p = {"q": q, "license_type": "commercial", "page_size": 20, "mature": "false"}
        d = json.loads(get("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(p)))
        for r in d.get("results", []):
            if r["id"] in seen or r["license"] not in OK or min(r.get("width") or 0, r.get("height") or 0) < 700: continue
            seen.add(r["id"])
            cands.append({k: r.get(k) for k in ("id", "title", "creator", "creator_url", "license", "license_version", "license_url",
                                                 "foreign_landing_url", "url", "source", "width", "height", "attribution")})
        time.sleep(4)
    kept = []
    os.makedirs(f"thumbs3/{slug}", exist_ok=True)
    for c in cands:
        if len(kept) == 12: break
        try:
            im = Image.open(io.BytesIO(get(c["url"], tries=2))).convert("RGB"); im.thumbnail((220, 220))
            im.save(f"thumbs3/{slug}/{len(kept)}.jpg"); kept.append(c)
        except Exception as e:
            print("  skip", c["url"][:80], e)
        time.sleep(0.3)
    out[slug] = kept
    json.dump(out, open("ov_cands.json", "w"), indent=1, ensure_ascii=False)
    print(slug, len(kept), flush=True)
