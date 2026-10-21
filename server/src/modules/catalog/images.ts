import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, type Queryable } from '../../db/pool.js';

export interface ImageCredit {
  author: string;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string;
}

export interface ProductImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** 'contain' for isolated product shots on a plain background, 'cover' for lifestyle/texture photos. */
  fit: 'contain' | 'cover';
  credit: ImageCredit | null;
}

/** Local product photos live under this public path, generated at 400 and 800 px (see web/public/assets/products). */
export const PHOTO_PREFIX = '/assets/products/';

const illustration = (slug: string, view: number) => `/media/products/${slug}/${view}.svg`;

/** Gallery for a product: stored photos, or the generated illustrations when it has none. */
export function productImages(slug: string, title: string, stored: ProductImage[] | null | undefined): ProductImage[] {
  if (stored?.length) return stored;
  return [0, 1, 2, 3].map((n) => ({
    src: illustration(slug, n),
    alt: n === 0 ? `Illustration of ${title}` : `Illustration of ${title}, alternate view ${n}`,
    width: 600,
    height: 600,
    fit: 'cover' as const,
    credit: null,
  }));
}

/** The one canonical image (and its alt text) every surface shows for a product. */
export function primaryImage(slug: string, title: string, stored: ProductImage[] | null | undefined) {
  const img = productImages(slug, title, stored)[0];
  return { image: img.src, imageAlt: img.alt, imageFit: img.fit ?? 'cover' };
}

// ---- Asset manifest -> database ------------------------------------------------------------

/** Directory served at PHOTO_PREFIX (web/public is copied into the client build). */
export const ASSET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../web/public/assets/products');
const MANIFEST = path.join(ASSET_DIR, 'manifest.json');

/** Only images whose source page is on one of these hosts may be imported. */
export const ALLOWED_SOURCE_HOSTS = ['commons.wikimedia.org', 'www.flickr.com', 'wordpress.org'];
export const ALLOWED_LICENCES = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+)$/;

interface ManifestImage {
  file: string; alt: string; width: number; height: number; fit?: 'contain' | 'cover';
  source: { title?: string; author: string; license: string; licenseUrl: string | null; page: string };
}
interface ManifestEntry {
  title?: string;
  images: ManifestImage[];
}

export function readManifest(file = MANIFEST): Record<string, ManifestEntry> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')).products ?? {};
}

export function manifestImages(entry: ManifestEntry): ProductImage[] {
  return entry.images.map((i) => ({
    src: `${PHOTO_PREFIX}${i.file}-800.webp`,
    alt: i.alt,
    width: i.width,
    height: i.height,
    fit: i.fit ?? 'cover',
    credit: { author: i.source.author, license: i.source.license, licenseUrl: i.source.licenseUrl, sourceUrl: i.source.page },
  }));
}

/**
 * Brings product photos in line with the asset manifest, matched by slug. Only rows with no photos or
 * with manifest-managed photos (under PHOTO_PREFIX) are touched, so images set another way are kept.
 * Idempotent; returns the number of rows changed.
 */
export async function applyImageManifest(client: Queryable = pool, manifest = readManifest(), assetDir = ASSET_DIR) {
  const { errors } = validateManifest(manifest, assetDir);
  if (errors.length) {
    // Never replace approved images with an unvalidated set: keep the catalogue as it is.
    console.error(`product images: manifest has ${errors.length} problem(s); not applied.\n  ${errors.slice(0, 10).join('\n  ')}`);
    return 0;
  }
  const rows = Object.entries(manifest).map(([slug, e]) => ({ slug, images: manifestImages(e) }));
  if (!rows.length) return 0;
  const res = await client.query(
    `UPDATE products p SET images = m.images, updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS m(slug text, images jsonb)
     WHERE p.slug = m.slug AND p.images IS DISTINCT FROM m.images
       AND (p.images = '[]'::jsonb OR p.images->0->>'src' LIKE '${PHOTO_PREFIX}%')`,
    [JSON.stringify(rows)],
  );
  return res.rowCount ?? 0;
}

// ---- Validation and dry-run planning ------------------------------------------------------

/** Width/height from a WebP header (VP8, VP8L or VP8X), or null if the bytes are not a WebP image. */
export function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  return null;
}

/**
 * Checks every manifest image before it can reach the catalogue: allow-listed source host, permitted
 * licence, alt text, safe file name, both WebP renditions present with a valid signature and the
 * expected dimensions, and no duplicate files.
 */
export function validateManifest(manifest: Record<string, ManifestEntry>, assetDir = ASSET_DIR) {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const [slug, entry] of Object.entries(manifest)) {
    if (!/^[a-z0-9-]+$/.test(slug)) errors.push(`${slug}: invalid slug`);
    if (!entry.images?.length) errors.push(`${slug}: no images`);
    for (const img of entry.images ?? []) {
      const where = `${slug}/${img.file}`;
      if (!new RegExp(`^${slug}/\\d+-[0-9a-f]{10}$`).test(img.file)) errors.push(`${where}: unexpected file name`);
      let host = '';
      try { host = new URL(img.source?.page).host; } catch { /* reported below */ }
      if (!ALLOWED_SOURCE_HOSTS.includes(host)) errors.push(`${where}: source host "${host}" is not allow-listed`);
      if (!ALLOWED_LICENCES.test(img.source?.license ?? '')) errors.push(`${where}: licence "${img.source?.license}" not permitted`);
      if (!img.source?.author?.trim()) errors.push(`${where}: missing author/attribution`);
      if ((img.alt ?? '').trim().length < 10) errors.push(`${where}: alt text missing or too short`);
      for (const w of [400, 800]) {
        const file = path.join(assetDir, `${img.file}-${w}.webp`);
        if (!fs.existsSync(file)) { errors.push(`${where}-${w}.webp: file missing`); continue; }
        const buf = fs.readFileSync(file);
        const size = webpSize(buf);
        if (!size) { errors.push(`${where}-${w}.webp: not a valid WebP file`); continue; }
        if (size.width !== w || size.height !== w) errors.push(`${where}-${w}.webp: is ${size.width}x${size.height}, expected ${w}x${w}`);
        if (buf.length < 2_000 || buf.length > 600_000) errors.push(`${where}-${w}.webp: unexpected size ${buf.length} bytes`);
        if (w === 800) {
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          const dup = seen.get(hash);
          if (dup) errors.push(`${where}: duplicate of ${dup}`);
          else seen.set(hash, where);
        }
      }
    }
  }
  return { errors };
}

/** JSON with sorted keys, so values read back from jsonb (which reorders keys) compare equal. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`
  : JSON.stringify(v);

export type SyncAction = 'update' | 'unchanged' | 'kept-custom' | 'illustration' | 'not-in-catalogue';

/** What applyImageManifest would do to each product, without changing anything. */
export async function planImageSync(client: Queryable = pool, manifest = readManifest()) {
  const { rows } = await client.query(
    `SELECT p.id, p.slug, p.title, c.name AS category, p.images FROM products p JOIN categories c ON c.id = p.category_id ORDER BY c.sort_order, p.title`,
  );
  const plan: { id: string; slug: string; title: string; category: string; current: string; proposed: string | null; action: SyncAction; attribution: string }[] = rows.map((r) => {
    const entry = manifest[r.slug];
    const current = productImages(r.slug, r.title, r.images)[0].src;
    const managed = !r.images.length || String(r.images[0]?.src ?? '').startsWith(PHOTO_PREFIX);
    const proposed = entry ? manifestImages(entry) : null;
    const action: SyncAction = !proposed ? (r.images.length ? 'kept-custom' : 'illustration')
      : !managed ? 'kept-custom'
      : canonical(r.images) === canonical(proposed) ? 'unchanged' : 'update';
    const credit = (proposed ?? r.images)[0]?.credit as ImageCredit | null | undefined;
    return { id: r.id as string, slug: r.slug as string, title: r.title as string, category: r.category as string, current,
      proposed: proposed?.[0].src ?? null, action, attribution: credit ? `${credit.author} · ${credit.license} · ${credit.sourceUrl}` : '' };
  });
  const known = new Set(rows.map((r) => r.slug));
  for (const slug of Object.keys(manifest)) if (!known.has(slug)) {
    plan.push({ id: '', slug, title: manifest[slug].title ?? slug, category: '', current: '', proposed: null, action: 'not-in-catalogue', attribution: '' });
  }
  return plan;
}
