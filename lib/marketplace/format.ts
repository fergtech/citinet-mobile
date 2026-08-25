import { MarketplaceListing } from '@/lib/api/types';

// Mirrors citinet web's formatPrice (MarketplaceScreen.tsx) exactly.
export function formatListingPrice(listing: Pick<MarketplaceListing, 'price' | 'price_type'>): string {
  if (listing.price_type === 'free') return 'Free';
  if (listing.price_type === 'contact') return 'Contact';
  if (listing.price == null) return 'Contact';
  const formatted = `$${Number(listing.price).toFixed(2)}`;
  if (listing.price_type === 'hourly') return `${formatted}/hr`;
  if (listing.price_type === 'negotiable') return `${formatted} OBO`;
  return formatted;
}
