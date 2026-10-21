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
    credit: null,
  }));
}

/** The one canonical image (and its alt text) every surface shows for a product. */
export function primaryImage(slug: string, title: string, stored: ProductImage[] | null | undefined) {
  const img = productImages(slug, title, stored)[0];
  return { image: img.src, imageAlt: img.alt };
}

// ---- Asset manifest -> database ------------------------------------------------------------

const MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../web/public/assets/products/manifest.json');

interface ManifestEntry {
  images: { file: string; alt: string; width: number; height: number; source: { author: string; license: string; licenseUrl: string | null; page: string } }[];
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
    credit: { author: i.source.author, license: i.source.license, licenseUrl: i.source.licenseUrl, sourceUrl: i.source.page },
  }));
}

/**
 * Brings product photos in line with the asset manifest, matched by slug. Only rows with no photos or
 * with manifest-managed photos (under PHOTO_PREFIX) are touched, so images set another way are kept.
 * Idempotent; returns the number of rows changed.
 */
export async function applyImageManifest(client: Queryable = pool, manifest = readManifest()) {
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
