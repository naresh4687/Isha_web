import { fireEvent, render } from '@testing-library/react';
import { FALLBACK_IMAGE, ProductImage, fallbackChain, srcSetFor } from './ProductImage';

const photo = '/assets/products/cork-yoga-block/0-abcdef1234-800.webp';

describe('ProductImage', () => {
  it('builds a responsive srcset only for local photos', () => {
    expect(srcSetFor(photo)).toBe('/assets/products/cork-yoga-block/0-abcdef1234-400.webp 400w, /assets/products/cork-yoga-block/0-abcdef1234-800.webp 800w');
    expect(srcSetFor('/media/products/x/0.svg')).toBeUndefined();
  });

  it('orders fallbacks photo → illustration → local placeholder, without duplicates', () => {
    expect(fallbackChain(photo, 'cork-yoga-block')).toEqual([photo, '/media/products/cork-yoga-block/0.svg', FALLBACK_IMAGE]);
    expect(fallbackChain('/media/products/x/0.svg', 'x')).toEqual(['/media/products/x/0.svg', FALLBACK_IMAGE]);
    expect(fallbackChain(FALLBACK_IMAGE)).toEqual([FALLBACK_IMAGE]);
  });

  it('is lazy with explicit dimensions and alt text by default, eager when asked', () => {
    const { container, rerender } = render(<ProductImage src={photo} alt="Two cork yoga blocks" slug="cork-yoga-block" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', 'Two cork yoga blocks');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width', '800');
    expect(img).toHaveAttribute('height', '800');
    expect(img.getAttribute('srcset')).toContain('400w');
    rerender(<ProductImage src={photo} alt="Two cork yoga blocks" slug="cork-yoga-block" eager />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'eager');
  });

  it('walks the fallback chain on errors and stops at the last source (no loop)', () => {
    const { container } = render(<ProductImage src={photo} alt="" slug="cork-yoga-block" />);
    const current = () => container.querySelector('img')!;
    fireEvent.error(current());
    expect(current()).toHaveAttribute('src', '/media/products/cork-yoga-block/0.svg');
    fireEvent.error(current());
    expect(current()).toHaveAttribute('src', FALLBACK_IMAGE);
    fireEvent.error(current());
    fireEvent.error(current());
    expect(current()).toHaveAttribute('src', FALLBACK_IMAGE);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('shows a placeholder until the image loads', () => {
    const { container } = render(<ProductImage src={photo} alt="" />);
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    expect(container.querySelector('img')!.className).toContain('opacity-100');
  });

  it('keeps isolated product shots whole with contain, but not once it has fallen back', () => {
    const { container } = render(<ProductImage src={photo} alt="" slug="cork-yoga-block" fit="contain" />);
    expect(container.querySelector('img')!.className).toContain('object-contain');
    expect(container.firstElementChild!.className).toContain('bg-white');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')!.className).toContain('object-cover');
  });
});
