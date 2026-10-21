// Product image sync: validates the asset manifest, shows what would change in the catalogue, and only
// writes when asked. Safe to rerun; never touches images that were not set from the manifest.
//   npm run images:sync                      dry run (default): validate + plan, no writes
//   npm run images:sync -- --apply           validate, then apply in one statement
//   npm run images:sync -- --report=FILE.md  also write the inventory (id, name, category, image, status, attribution)
import fs from 'node:fs';
import { pool } from '../db/pool.js';
import { applyImageManifest, planImageSync, readManifest, validateManifest } from '../modules/catalog/images.js';

const apply = process.argv.includes('--apply');
const report = process.argv.find((a) => a.startsWith('--report='))?.slice('--report='.length);
const started = new Date().toISOString();

const manifest = readManifest();
const { errors } = validateManifest(manifest);
const plan = await planImageSync(pool, manifest);
const count = (a: string) => plan.filter((p) => p.action === a).length;

console.log(`image sync ${apply ? 'APPLY' : 'DRY RUN'} at ${started}`);
console.log(`manifest: ${Object.keys(manifest).length} products; validation: ${errors.length ? `${errors.length} error(s)` : 'ok'}`);
for (const e of errors) console.log(`  ✗ ${e}`);
for (const p of plan.filter((x) => x.action === 'update' || x.action === 'not-in-catalogue')) console.log(`  ${p.action.padEnd(16)} ${p.slug}  ${p.current} -> ${p.proposed ?? '-'}`);
console.log(`plan: ${count('update')} to update, ${count('unchanged')} unchanged, ${count('kept-custom')} kept (custom), ${count('illustration')} on illustration, ${count('not-in-catalogue')} manifest entries without a product`);

if (report) {
  const esc = (s: string) => s.replace(/\|/g, '/');
  const lines = [
    `# Product image inventory`, '', `Generated ${started} (${apply ? 'after apply' : 'dry run'}).`, '',
    '| Product ID | Product | Category | Current image | Status | Attribution |', '|---|---|---|---|---|---|',
    ...plan.map((p) => `| ${p.id} | ${esc(p.title)} | ${esc(p.category)} | ${p.current} | ${p.action} | ${esc(p.attribution)} |`),
  ];
  fs.writeFileSync(report, lines.join('\n') + '\n');
  console.log(`report written to ${report}`);
}

let exit = 0;
if (errors.length) {
  console.log('validation failed: nothing applied');
  exit = 1;
} else if (apply) {
  const changed = await applyImageManifest(pool, manifest);
  console.log(`applied: ${changed} product(s) updated`);
}
await pool.end();
process.exit(exit);
