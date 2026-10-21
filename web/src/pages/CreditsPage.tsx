import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorState, Spinner } from '../components/ui';
import { ProductImage } from '../components/ProductImage';

interface ManifestImage {
  file: string;
  alt: string;
  source: { title: string; page: string; author: string; license: string; licenseUrl: string | null };
}
interface Manifest {
  policy: string;
  products: Record<string, { title: string; images: ManifestImage[] }>;
  unresolved: Record<string, { title: string; reason: string }>;
}

/** Attribution for every licensed photo, generated from the same manifest that feeds the catalogue. */
export default function CreditsPage() {
  const m = useQuery({
    queryKey: ['image-manifest'],
    queryFn: async () => {
      const res = await fetch('/assets/products/manifest.json');
      if (!res.ok) throw new Error('Image credits are unavailable right now.');
      return (await res.json()) as Manifest;
    },
    staleTime: 60 * 60_000,
  });
  return (
    <div className="page max-w-4xl pt-12">
      <p className="eyebrow">About our images</p>
      <h1 className="mt-2 text-5xl">Image credits</h1>
      <p className="mt-4 max-w-2xl text-ink/85">
        This is a demonstration store. Product photos are representative images under free licences from Wikimedia Commons, used to
        show the kind of item each listing describes; they do not show the exact item sold. Photos are cropped and resized.
        Items without a suitable licensed photo use the store's own illustrations.
      </p>
      {m.isLoading ? <Spinner /> : m.isError ? <ErrorState error={m.error} /> : (
        <>
          <ul className="mt-10 divide-y divide-line border-y border-line">
            {Object.entries(m.data!.products).flatMap(([slug, p]) => p.images.map((img) => (
              <li key={img.file} className="flex items-center gap-4 py-4">
                <ProductImage src={`/assets/products/${img.file}-800.webp`} alt="" sizes="64px" className="aspect-square h-16 w-16 shrink-0 rounded-xl border border-line" />
                <div className="min-w-0 text-sm">
                  <Link to={`/products/${slug}`} className="font-medium hover:underline">{p.title}</Link>
                  <p className="text-muted">
                    <a className="underline underline-offset-2" href={img.source.page} target="_blank" rel="noopener noreferrer">{img.source.title.replace(/^File:/, '')}</a>
                    {' by '}{img.source.author || 'unknown author'}{' · '}
                    {img.source.licenseUrl ? <a className="underline underline-offset-2" href={img.source.licenseUrl} target="_blank" rel="noopener license noreferrer">{img.source.license}</a> : img.source.license}
                  </p>
                </div>
              </li>
            )))}
          </ul>
          {Object.keys(m.data!.unresolved).length > 0 && (
            <p className="mt-6 text-sm text-muted">
              {Object.keys(m.data!.unresolved).length} products use illustrations because no suitably licensed photo matched them.
            </p>
          )}
        </>
      )}
    </div>
  );
}
