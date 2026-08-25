import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { ListingPriceType } from '@/lib/api/types';

// Mirrors citinet web's real LISTING_CATEGORIES (AddListingModal.tsx) plus
// an "All" entry for the filter chip row — icons are this app's IconSymbol
// names (real vector icons, never emoji), colors follow the same category-
// badge convention as lib/atlas/categories.ts.
export type MarketplaceCategory = 'Goods' | 'Services' | 'Food' | 'Electronics' | 'Events' | 'Arts & Crafts' | 'Other';

export const MARKETPLACE_CATEGORIES: Record<MarketplaceCategory, { color: string; icon: IconSymbolName }> = {
  Goods: { color: '#2563eb', icon: 'shippingbox.fill' },
  Services: { color: '#7c3aed', icon: 'wrench.and.screwdriver.fill' },
  Food: { color: '#e11d48', icon: 'fork.knife' },
  Electronics: { color: '#0891b2', icon: 'desktopcomputer' },
  Events: { color: '#d97706', icon: 'calendar' },
  'Arts & Crafts': { color: '#c026d3', icon: 'paintpalette.fill' },
  Other: { color: '#64748b', icon: 'ellipsis.circle.fill' },
};

export const MARKETPLACE_CATEGORY_ORDER: MarketplaceCategory[] = [
  'Goods',
  'Services',
  'Food',
  'Electronics',
  'Events',
  'Arts & Crafts',
  'Other',
];

export function categoryMeta(category: string): { color: string; icon: IconSymbolName } {
  return MARKETPLACE_CATEGORIES[category as MarketplaceCategory] ?? MARKETPLACE_CATEGORIES.Other;
}

// Vendor page categories (CreateVendorModal.tsx's VENDOR_CATEGORIES) — a
// separate, broader list from listing categories above (a vendor is a
// business/organization; its listings can span multiple listing categories).
export const VENDOR_CATEGORIES = [
  'General',
  'Food & Beverage',
  'Services',
  'Goods & Products',
  'Arts & Crafts',
  'Technology',
  'Health & Wellness',
  'Events & Education',
  'Other',
];

// Real citinet price-type badge copy (MarketplaceScreen.tsx KIND_META) —
// "Services" from the pasted spec's type-chip set doesn't belong here, it's
// a category (see above); a service listing still picks one of these five.
export const PRICE_TYPE_META: Record<ListingPriceType, { label: string; color: string }> = {
  fixed: { label: 'For sale', color: '#059669' },
  negotiable: { label: 'Negotiable', color: '#d97706' },
  free: { label: 'Free', color: '#9333ea' },
  hourly: { label: 'Hourly', color: '#0284c7' },
  contact: { label: 'Contact', color: '#64748b' },
};

export const PRICE_TYPE_ORDER: ListingPriceType[] = ['fixed', 'negotiable', 'free', 'hourly', 'contact'];

export const LISTING_CONDITIONS = ['New', 'Like New', 'Used', 'Fair'];
