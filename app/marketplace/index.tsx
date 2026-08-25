import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { HubMedia } from '@/components/hub-media';
import { ListingCard } from '@/components/marketplace/listing-card';
import { VendorLogo } from '@/components/marketplace/vendor-logo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMarketplaceBannerConfig, listMarketplaceListings, listVendors } from '@/lib/api/hubService';
import { MarketplaceBannerConfig, MarketplaceListing, MarketplaceVendor } from '@/lib/api/types';
import { categoryMeta, MARKETPLACE_CATEGORY_ORDER } from '@/lib/marketplace/categories';
import { useSavedListings } from '@/lib/marketplace/saved-listings';
import { useSession } from '@/lib/session/session-context';

type CategoryFilter = 'All' | string;

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function MarketplaceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { isSaved, toggleSaved } = useSavedListings();
  const { saved: savedParam } = useLocalSearchParams<{ saved?: string }>();

  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [vendors, setVendors] = useState<MarketplaceVendor[]>([]);
  const [banner, setBanner] = useState<MarketplaceBannerConfig>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [savedOnly, setSavedOnly] = useState(savedParam === 'true');

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listMarketplaceListings(session.hub.tunnelUrl, session.token),
      listVendors(session.hub.tunnelUrl, session.token).catch(() => []),
      getMarketplaceBannerConfig(session.hub.tunnelUrl, session.token).catch(() => ({})),
    ])
      .then(([nextListings, nextVendors, nextBanner]) => {
        setListings(nextListings);
        setVendors(nextVendors);
        setBanner(nextBanner);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the marketplace.'))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  const filtered = useMemo(() => {
    let next = categoryFilter === 'All' ? listings : listings.filter((l) => l.category === categoryFilter);
    if (savedOnly) next = next.filter((l) => isSaved(l.id));
    const q = query.trim().toLowerCase();
    if (q) {
      next = next.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          l.vendor_name.toLowerCase().includes(q)
      );
    }
    return next;
  }, [listings, categoryFilter, savedOnly, isSaved, query]);

  const topVendors = useMemo(() => [...vendors].sort((a, b) => (b.listing_count ?? 0) - (a.listing_count ?? 0)).slice(0, 3), [vendors]);

  const stats = useMemo(
    () => ({
      active: listings.length,
      freeThisMonth: listings.filter((l) => l.price_type === 'free' && isThisMonth(l.created_at)).length,
      vendorCount: vendors.length,
    }),
    [listings, vendors]
  );

  if (!session) return null;

  const bannerPosition = Number(banner.marketplace_banner_position) || 50;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Marketplace
        </ThemedText>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSavedOnly((v) => !v)}
            hitSlop={12}
            accessibilityLabel={savedOnly ? 'Show all listings' : 'Show saved listings only'}
            accessibilityRole="button">
            <IconSymbol name={savedOnly ? 'bookmark.fill' : 'bookmark'} size={22} color={savedOnly ? Brand : Colors[colorScheme].text} />
          </Pressable>
          <Pressable onPress={() => router.push('/marketplace/editor')} hitSlop={12} accessibilityLabel="New listing" accessibilityRole="button">
            <IconSymbol name="plus" size={24} color={Colors[colorScheme].text} />
          </Pressable>
        </View>
      </View>

      {loading && listings.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            tunnelUrl={session.hub.tunnelUrl}
            token={session.token}
            onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: item.id } })}
            saved={isSaved(item.id)}
            onToggleSave={() => toggleSaved(item.id)}
            style={styles.gridCard}
          />
        )}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            {/* Hero banner — admin-configurable */}
            <Pressable
              style={styles.banner}
              disabled={!session.isAdmin}
              onPress={() => router.push('/marketplace/banner-editor')}>
              {banner.marketplace_banner_image ? (
                <HubMedia
                  fileName={banner.marketplace_banner_image}
                  tunnelUrl={session.hub.tunnelUrl}
                  token={session.token}
                  style={styles.bannerImage}
                  contentPosition={{ top: `${bannerPosition}%` }}
                />
              ) : (
                <View style={styles.bannerFallback}>
                  <IconSymbol name="storefront.fill" size={56} color="rgba(255,255,255,0.14)" />
                </View>
              )}
              <View style={styles.bannerScrim} />
              <View style={styles.bannerText}>
                <ThemedText style={styles.bannerEyebrow}>Local Exchange</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.bannerHeading} lightColor="#fff" darkColor="#fff">
                  {banner.marketplace_banner_title || 'Everything local, right here'}
                </ThemedText>
                {!!banner.marketplace_banner_subtitle && (
                  <ThemedText style={styles.bannerSubtitle} lightColor="#e2e8f0" darkColor="#e2e8f0">
                    {banner.marketplace_banner_subtitle}
                  </ThemedText>
                )}
              </View>
              {session.isAdmin && (
                <View style={styles.bannerEditBadge}>
                  <IconSymbol name="pencil" size={13} color="#fff" />
                </View>
              )}
            </Pressable>

            {session.isAdmin && (
              <View style={styles.statsPanel}>
                <View style={styles.statItem}>
                  <ThemedText type="defaultSemiBold" style={styles.statValue}>
                    {stats.active}
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>Active listings</ThemedText>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <ThemedText type="defaultSemiBold" style={styles.statValue}>
                    {stats.freeThisMonth}
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>Given free this month</ThemedText>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <ThemedText type="defaultSemiBold" style={styles.statValue}>
                    {stats.vendorCount}
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>Total vendors</ThemedText>
                </View>
              </View>
            )}

            <View style={styles.searchRow}>
              <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search the marketplace"
                placeholderTextColor={Colors[colorScheme].icon}
                style={[styles.searchInput, { color: Colors[colorScheme].text }]}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Pressable onPress={() => setCategoryFilter('All')} style={[styles.chip, categoryFilter === 'All' && { backgroundColor: Brand }]}>
                <ThemedText style={styles.chipLabel} lightColor={categoryFilter === 'All' ? '#fff' : undefined} darkColor={categoryFilter === 'All' ? '#fff' : undefined}>
                  All
                </ThemedText>
              </Pressable>
              {MARKETPLACE_CATEGORY_ORDER.map((cat) => {
                const meta = categoryMeta(cat);
                const active = categoryFilter === cat;
                return (
                  <Pressable key={cat} onPress={() => setCategoryFilter(cat)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                    <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {cat}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {topVendors.length > 0 && (
              <View style={styles.vendorsSection}>
                <ThemedText style={styles.sectionLabel}>Community vendors</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vendorsRow}>
                  {topVendors.map((vendor) => (
                    <Pressable
                      key={vendor.id}
                      style={styles.vendorCard}
                      onPress={() => router.push({ pathname: '/marketplace/vendor/[id]', params: { id: vendor.id } })}>
                      <VendorLogo fileName={vendor.logo_file_name} name={vendor.name} tunnelUrl={session.hub.tunnelUrl} token={session.token} size={40} />
                      <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.vendorName}>
                        {vendor.name}
                      </ThemedText>
                      <ThemedText style={styles.vendorMeta}>
                        {vendor.listing_count ?? 0} {vendor.listing_count === 1 ? 'listing' : 'listings'}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <ThemedText style={styles.empty}>
              {query.trim()
                ? 'No listings match your search.'
                : savedOnly
                  ? 'No saved listings yet — tap the bookmark on any listing to save it here.'
                  : 'Nothing listed yet — be the first to list something for the neighborhood.'}
            </ThemedText>
          ) : null
        }
        onScrollBeginDrag={Keyboard.dismiss}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  listFlex: {
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
  title: {
    fontSize: 17,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginVertical: 8,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  // Fixed 48% width, not flex:1 — an odd item count leaves the last row with
  // a single card, and flex:1 would stretch that lone card to the full row
  // width instead of sitting at half-width like every other card. Same
  // convention as Discover's/vendor profile's own 2-column grids.
  gridRow: {
    justifyContent: 'space-between',
  },
  gridCard: {
    width: '48%',
    marginBottom: 12,
  },
  headerContent: {
    paddingBottom: 4,
  },
  banner: {
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#18181b',
  },
  bannerImage: {
    ...StyleSheet.absoluteFillObject,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  bannerFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  bannerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.45)',
  },
  bannerText: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  bannerEyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#34d399',
    marginBottom: 4,
  },
  bannerHeading: {
    fontSize: 17,
    lineHeight: 22,
  },
  bannerSubtitle: {
    fontSize: 13,
    marginTop: 3,
  },
  bannerEditBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#8881',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#8884',
  },
  statValue: {
    fontSize: 17,
  },
  statLabel: {
    fontSize: 10.5,
    opacity: 0.6,
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  vendorsSection: {
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  vendorsRow: {
    gap: 10,
  },
  vendorCard: {
    width: 100,
    alignItems: 'center',
    gap: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#8881',
  },
  vendorName: {
    fontSize: 12,
    textAlign: 'center',
  },
  vendorMeta: {
    fontSize: 10.5,
    opacity: 0.6,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
});
