export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  category: { slug: string; name: string };
  subcategory: string | null;
  pricePaise: number;
  compareAtPaise: number | null;
  discountPct: number;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  lowStock: boolean;
  isNew: boolean;
  image: string;
  tags: string[];
}

export interface Variant {
  id: string;
  sku: string;
  name: string;
  pricePaise: number;
  compareAtPaise: number | null;
  inStock: boolean;
  maxQuantity: number;
  isDefault: boolean;
}

export interface ProductDetail extends ProductCard {
  description: string;
  attributes: Record<string, string>;
  images: string[];
  variants: Variant[];
  ratingDistribution: Record<string, number>;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Category {
  slug: string;
  name: string;
  description: string;
  subcategories: string[];
  productCount: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  categoryPrefs: string[];
  marketingConsent: boolean;
}

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantName: string;
  unitPricePaise: number;
  compareAtPaise: number | null;
  quantity: number;
  lineTotalPaise: number;
  stock: number;
  available: boolean;
  image: string;
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  freeShippingThresholdPaise: number;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  itemCount: number;
  totals: Totals;
  discount: { code: string; error?: string } | null;
  hasUnavailable: boolean;
}

export interface Order {
  id: string;
  orderNumber: number;
  status: 'pending_payment' | 'payment_failed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  refundedPaise: number;
  discountCode: string | null;
  shippingAddress: Record<string, string>;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  items?: {
    id: string; productId: string; slug: string; title: string; variantName: string; unitPricePaise: number; quantity: number;
    lineTotalPaise: number; image: string; refundedQuantity: number; refundedPaise: number; returnable: boolean;
  }[];
  returns?: { id: string; items: { orderItemId: string; quantity: number }[]; reason: string; status: 'requested' | 'refunded' | 'rejected'; adminNote: string | null; createdAt: string }[];
  returnWindowOpen?: boolean;
  returnDeadline?: string | null;
  tax?: {
    rows: { rateBps: number; inclusivePaise: number; taxablePaise: number; taxPaise: number }[];
    taxablePaise: number;
    taxPaise: number;
    split: { type: 'CGST+SGST'; cgstPaise: number; sgstPaise: number } | { type: 'IGST'; igstPaise: number } | null;
    note: string;
  } | null;
  itemCount?: number;
  payment?: { provider: string; status: string; failureReason: string | null } | null;
  cancellable?: boolean;
}

export interface RecItem {
  product: ProductCard;
  position: number;
  score: number | null;
  reasons: string[];
}

export interface RecResponse {
  placement: string;
  source: 'model' | 'fallback' | 'client_history';
  strategy: string | null;
  modelVersion: string | null;
  items: RecItem[];
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  createdAt: string;
  author: string;
}
