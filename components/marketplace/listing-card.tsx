import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { VendorLogo } from '@/components/marketplace/vendor-logo';
import { MarketplaceListing } from '@/lib/api/types';
import { categoryMeta, PRICE_TYPE_META } from '@/lib/marketplace/categories';
import { formatListingPrice } from '@/lib/marketplace/format';
import { timeAgo } from '@/lib/ui/time-ago';

// The marketplace equivalent of components/atlas/pin-card.tsx — shared by
// the Marketplace grid, Discover's Marketplace section, and "More from this
// seller" strips. Unlike AtlasPinCard this always tries a real photo first
// (HubMedia), falling back to a colored category-icon badge only when the
// listing has none — mirrors citinet web's ListingCard image-or-icon block.
export function ListingCard({
  listing,
  tunnelUrl,
  token,
  onPress,
  saved,
  onToggleSave,
  style,
}: {
  listing: MarketplaceListing;
  tunnelUrl: string;
  token: string;
  onPress: () => void;
  // Both omitted in read-only contexts (Discover's preview, "More from this
  // seller") — the inline save toggle only makes sense in a screen that owns
  // a useSavedListings() instance, i.e. the Marketplace grid itself.
  saved?: boolean;
  onToggleSave?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const category = categoryMeta(listing.category);
  const kind = PRICE_TYPE_META[listing.price_type] ?? PRICE_TYPE_META.fixed;

  return (
    <Pressable style={[styles.card, style]} onPress={onPress}>
      <View style={[styles.imageBox, { backgroundColor: category.color }]}>
        {listing.image_file_name ? (
          <HubMedia fileName={listing.image_file_name} tunnelUrl={tunnelUrl} token={token} style={styles.image} />
        ) : (
          <IconSymbol name={category.icon} size={28} color="rgba(255,255,255,0.9)" />
        )}
        <View style={[styles.kindBadge, { backgroundColor: kind.color }]}>
          <ThemedText style={styles.kindLabel} lightColor="#fff" darkColor="#fff">
            {kind.label}
          </ThemedText>
        </View>
        {onToggleSave && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            hitSlop={8}
            style={styles.saveBadge}
            accessibilityLabel={saved ? 'Unsave' : 'Save'}>
            <IconSymbol name={saved ? 'bookmark.fill' : 'bookmark'} size={13} color="#fff" />
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.title}>
            {listing.title}
          </ThemedText>
          <ThemedText
            style={styles.price}
            lightColor={listing.price_type === 'fixed' ? '#059669' : undefined}
            darkColor={listing.price_type === 'fixed' ? '#34d399' : undefined}>
            {formatListingPrice(listing)}
          </ThemedText>
        </View>
        <View style={styles.sellerRow}>
          <VendorLogo fileName={listing.vendor_logo_file_name} name={listing.vendor_name} tunnelUrl={tunnelUrl} token={token} size={16} />
          <ThemedText numberOfLines={1} style={styles.sellerName}>
            {listing.vendor_name}
          </ThemedText>
          <ThemedText style={styles.time}>{timeAgo(listing.created_at)}</ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: '#8881',
    overflow: 'hidden',
  },
  imageBox: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    aspectRatio: undefined,
  },
  kindBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  kindLabel: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  saveBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: 10,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 13,
  },
  price: {
    fontSize: 13,
    fontWeight: '700',
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sellerName: {
    flex: 1,
    fontSize: 11,
    opacity: 0.65,
  },
  time: {
    fontSize: 10,
    opacity: 0.45,
  },
});
