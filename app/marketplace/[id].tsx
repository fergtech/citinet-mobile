import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { HubMedia } from '@/components/hub-media';
import { ListingCard } from '@/components/marketplace/listing-card';
import { VendorLogo } from '@/components/marketplace/vendor-logo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createConversation, deleteListing, getVendor, listMarketplaceListings } from '@/lib/api/hubService';
import { MarketplaceListing, MarketplaceVendor } from '@/lib/api/types';
import { categoryMeta } from '@/lib/marketplace/categories';
import { formatListingPrice } from '@/lib/marketplace/format';
import { useSavedListings } from '@/lib/marketplace/saved-listings';
import { confirmDestructive } from '@/lib/ui/confirm';
import { timeAgo } from '@/lib/ui/time-ago';
import { useSession } from '@/lib/session/session-context';

export default function ListingDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { isSaved, toggleSaved } = useSavedListings();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [vendor, setVendor] = useState<MarketplaceVendor | null>(null);
  const [moreFromSeller, setMoreFromSeller] = useState<MarketplaceListing[]>([]);
  // GET /api/vendors/:id's listings array is the seller's true active-listing
  // count — moreFromSeller is capped to 6 for the strip, so the seller-card
  // meta line reads from this instead (avoids undercounting a seller with
  // more than 6 other active listings).
  const [sellerListingCount, setSellerListingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // No single-listing GET route — same list-and-find approach as Atlas Pin
  // Detail. Vendor + their other listings come from GET /api/vendors/:id
  // once the listing (and its vendor_id) is known.
  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    listMarketplaceListings(session.hub.tunnelUrl, session.token)
      .then((all) => {
        const found = all.find((l) => l.id === id);
        if (!found) {
          setError('Listing not found.');
          return;
        }
        setListing(found);
        return getVendor(session.hub.tunnelUrl, session.token, found.vendor_id).then(({ vendor: v, listings }) => {
          setVendor(v);
          setSellerListingCount(listings.length);
          setMoreFromSeller(listings.filter((l) => l.id !== found.id).slice(0, 6));
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load this listing.'))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  const isOwnListing = useMemo(() => !!session && !!vendor && vendor.owner_user_id === session.userId, [session, vendor]);

  async function handleMessageSeller() {
    if (!session || !vendor) return;
    setMessaging(true);
    try {
      const convo = await createConversation(session.hub.tunnelUrl, session.token, vendor.owner_user_id);
      router.push({
        pathname: '/conversation/[id]',
        params: { id: convo.conversation_id, title: vendor.name, peerId: vendor.owner_user_id },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a conversation.');
    } finally {
      setMessaging(false);
    }
  }

  function handleDelete() {
    if (!session || !listing) return;
    confirmDestructive('Delete this listing?', 'Delete', async () => {
      setDeleting(true);
      try {
        await deleteListing(session.hub.tunnelUrl, session.token, listing.id);
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete that listing.");
        setDeleting(false);
      }
    });
  }

  if (!session) return null;

  const category = listing ? categoryMeta(listing.category) : null;
  const saved = listing ? isSaved(listing.id) : false;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          Listing
        </ThemedText>
        <Pressable
          onPress={() => listing && toggleSaved(listing.id)}
          disabled={!listing}
          hitSlop={12}
          accessibilityLabel={saved ? 'Unsave' : 'Save'}
          accessibilityRole="button">
          <IconSymbol name={saved ? 'bookmark.fill' : 'bookmark'} size={22} color={saved ? Brand : Colors[colorScheme].text} />
        </Pressable>
      </View>

      {loading && !listing && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {listing && category && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.imageBox, { backgroundColor: category.color }]}>
            {listing.image_file_name ? (
              <HubMedia fileName={listing.image_file_name} tunnelUrl={session.hub.tunnelUrl} token={session.token} style={styles.image} />
            ) : (
              <IconSymbol name={category.icon} size={64} color="rgba(255,255,255,0.85)" />
            )}
          </View>

          <View style={styles.titleRow}>
            <ThemedText type="title" style={styles.title}>
              {listing.title}
            </ThemedText>
            <ThemedText
              type="defaultSemiBold"
              style={styles.price}
              lightColor={listing.price_type === 'fixed' ? '#059669' : undefined}
              darkColor={listing.price_type === 'fixed' ? '#34d399' : undefined}>
              {formatListingPrice(listing)}
            </ThemedText>
          </View>
          <ThemedText style={styles.meta}>
            Posted {timeAgo(listing.created_at)} · {listing.category}
            {listing.condition ? ` · ${listing.condition.replace('-', ' ')}` : ''}
          </ThemedText>

          {listing.description && <ThemedText style={styles.description}>{listing.description}</ThemedText>}

          {vendor && (
            <Pressable
              style={styles.sellerCard}
              onPress={() => router.push({ pathname: '/marketplace/vendor/[id]', params: { id: vendor.id } })}>
              <VendorLogo fileName={vendor.logo_file_name} name={vendor.name} tunnelUrl={session.hub.tunnelUrl} token={session.token} size={44} />
              <View style={styles.sellerText}>
                <ThemedText type="defaultSemiBold" numberOfLines={1}>
                  {vendor.name}
                </ThemedText>
                <ThemedText style={styles.sellerMeta}>
                  {sellerListingCount} {sellerListingCount === 1 ? 'listing' : 'listings'} · Community vendor
                </ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
            </Pressable>
          )}

          {moreFromSeller.length > 0 && (
            <View style={styles.moreSection}>
              <ThemedText style={styles.sectionLabel}>More from {vendor?.name?.split(' ')[0] ?? 'this seller'}</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moreStrip}>
                {moreFromSeller.map((item) => (
                  <ListingCard
                    key={item.id}
                    listing={item}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: item.id } })}
                    style={styles.moreCard}
                  />
                ))}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      )}

      {listing && (
        <View style={[styles.actionsBar, { backgroundColor: Colors[colorScheme].background }]}>
          {isOwnListing ? (
            <>
              <Pressable
                onPress={() => router.push({ pathname: '/marketplace/editor', params: { id: listing.id } })}
                style={[styles.actionButton, styles.actionButtonSecondary]}>
                <IconSymbol name="pencil" size={16} color={Colors[colorScheme].text} />
                <ThemedText style={styles.actionLabel}>Edit</ThemedText>
              </Pressable>
              <Pressable onPress={handleDelete} disabled={deleting} style={[styles.actionButton, styles.actionButtonSecondary]}>
                {deleting ? <ActivityIndicator size="small" /> : <IconSymbol name="trash.fill" size={16} color="#b0392f" />}
                <ThemedText style={[styles.actionLabel, { color: '#b0392f' }]}>Delete</ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={handleMessageSeller} disabled={messaging || !vendor} style={[styles.actionButton, { backgroundColor: Brand, opacity: messaging ? 0.6 : 1 }]}>
              {messaging ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <IconSymbol name="paperplane.fill" size={16} color="#fff" />
                  <ThemedText style={styles.actionLabel} lightColor="#fff" darkColor="#fff">
                    Message seller
                  </ThemedText>
                </>
              )}
            </Pressable>
          )}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 17,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginVertical: 8,
  },
  body: {
    paddingBottom: 120,
  },
  imageBox: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  title: {
    flex: 1,
    fontSize: 21,
    lineHeight: 26,
  },
  price: {
    fontSize: 19,
  },
  meta: {
    fontSize: 12.5,
    opacity: 0.6,
    paddingHorizontal: 20,
    marginTop: 6,
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 20,
    marginTop: 14,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 18,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#8881',
  },
  sellerText: {
    flex: 1,
    gap: 2,
  },
  sellerMeta: {
    fontSize: 12,
    opacity: 0.6,
  },
  moreSection: {
    marginTop: 22,
    paddingLeft: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  moreStrip: {
    gap: 10,
    paddingRight: 20,
  },
  moreCard: {
    width: 140,
  },
  actionsBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    backgroundColor: 'transparent',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 13,
  },
  actionButtonSecondary: {
    backgroundColor: '#8881',
  },
  actionLabel: {
    fontSize: 14.5,
    fontWeight: '600',
  },
});
