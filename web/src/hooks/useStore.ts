import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Cart, Category, User } from '../api/types';
import { track } from '../lib/tracking';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User | null }>('/api/auth/me').then((r) => r.user),
    staleTime: 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories').then((r) => r.categories),
    staleTime: 10 * 60_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Record<string, any>>('/api/settings/public'),
    staleTime: 10 * 60_000,
  });
}

export function useCart(discountCode?: string) {
  return useQuery({
    queryKey: ['cart', discountCode ?? ''],
    queryFn: () => api<{ cart: Cart }>(`/api/cart${discountCode ? `?discountCode=${encodeURIComponent(discountCode)}` : ''}`).then((r) => r.cart),
  });
}

export function useCartMutations() {
  const qc = useQueryClient();
  const onCart = (cart: Cart) => {
    qc.setQueryData(['cart', ''], cart);
    qc.invalidateQueries({ queryKey: ['cart'] });
  };
  const add = useMutation({
    mutationFn: (v: { variantId: string; productId: string; quantity: number }) =>
      api<{ cart: Cart }>('/api/cart/items', { method: 'POST', json: { variantId: v.variantId, quantity: v.quantity } }),
    onSuccess: (r, v) => {
      onCart(r.cart);
      track({ type: 'add_to_cart', productId: v.productId, quantity: v.quantity });
    },
  });
  const setQty = useMutation({
    mutationFn: (v: { variantId: string; productId: string; quantity: number }) =>
      api<{ cart: Cart }>(`/api/cart/items/${v.variantId}`, { method: 'PATCH', json: { quantity: v.quantity } }),
    onSuccess: (r, v) => {
      onCart(r.cart);
      if (v.quantity === 0) track({ type: 'remove_from_cart', productId: v.productId });
    },
  });
  return { add, setQty };
}

export function useWishlist(enabled: boolean) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api<{ items: { id: string }[] }>('/api/wishlist').then((r) => r.items),
    enabled,
  });
  const toggle = useMutation({
    mutationFn: async ({ productId, on }: { productId: string; on: boolean }) => {
      if (on) await api('/api/wishlist', { method: 'POST', json: { productId } });
      else await api(`/api/wishlist/${productId}`, { method: 'DELETE' });
      return { productId, on };
    },
    onSuccess: ({ productId, on }) => {
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      track({ type: on ? 'add_to_wishlist' : 'remove_from_wishlist', productId });
    },
  });
  const ids = new Set((list.data ?? []).map((p) => p.id));
  return { list, toggle, has: (id: string) => ids.has(id) };
}
