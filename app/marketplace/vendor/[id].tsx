import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ListingCard } from '@/components/marketplace/listing-card';
import { VendorLogo } from '@/components/marketplace/vendor-logo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createConversation, getVendor } from '@/lib/api/hubService';
import { MarketplaceListing, MarketplaceVendor } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function VendorProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [vendor, setVendor] = useState<MarketplaceVendor | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    getVendor(session.hub.tunnelUrl, session.token, id)
      .then(({ vendor: v, listings: l }) => {
        setVendor(v);
        setListings(l.filter((item) => item.is_active !== false));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load this vendor.'))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  const isOwner = !!session && !!vendor && vendor.owner_user_id === session.userId;

  async function handleMessage() {
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

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
          Vendor
        </ThemedText>
        {isOwner ? (
          <Pressable onPress={() => router.push('/marketplace/vendor-editor')} hitSlop={12} accessibilityLabel="Edit vendor page" accessibilityRole="button">
            <IconSymbol name="pencil" size={20} color={Colors[colorScheme].text} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loading && !vendor && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {vendor && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <VendorLogo fileName={vendor.logo_file_name} name={vendor.name} tunnelUrl={session.hub.tunnelUrl} token={session.token} size={76} />
            <ThemedText type="title" style={styles.name}>
              {vendor.name}
            </ThemedText>
            <ThemedText style={styles.meta}>
              {(vendor.listing_count ?? listings.length)} {(vendor.listing_count ?? listings.length) === 1 ? 'listing' : 'listings'} · {session.hub.name}
            </ThemedText>
            <ThemedText style={styles.joined}>
              {vendor.category ? `${vendor.category} · ` : ''}Joined {memberSince(vendor.created_at)}
            </ThemedText>
          </View>

          {vendor.description && <ThemedText style={styles.bio}>{vendor.description}</ThemedText>}

          {(vendor.contact_phone || vendor.contact_email || vendor.website || vendor.hours) && (
            <View style={styles.contactRow}>
              {vendor.contact_phone && (
                <Pressable style={styles.contactItem} onPress={() => Linking.openURL(`tel:${vendor.contact_phone}`)}>
                  <IconSymbol name="phone.fill" size={13} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.contactLabel}>{vendor.contact_phone}</ThemedText>
                </Pressable>
              )}
              {vendor.contact_email && (
                <Pressable style={styles.contactItem} onPress={() => Linking.openURL(`mailto:${vendor.contact_email}`)}>
                  <IconSymbol name="envelope.fill" size={13} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.contactLabel}>{vendor.contact_email}</ThemedText>
                </Pressable>
              )}
              {vendor.website && (
                <Pressable
                  style={styles.contactItem}
                  onPress={() => Linking.openURL(vendor.website!.startsWith('http') ? vendor.website! : `https://${vendor.website}`)}>
                  <IconSymbol name="globe" size={13} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.contactLabel} numberOfLines={1}>
                    {vendor.website}
                  </ThemedText>
                </Pressable>
              )}
              {vendor.hours && (
                <View style={styles.contactItem}>
                  <IconSymbol name="clock.fill" size={13} color={Colors[colorScheme].icon} />
                  <ThemedText style={styles.contactLabel}>{vendor.hours}</ThemedText>
                </View>
              )}
            </View>
          )}

          {!isOwner && (
            <Pressable onPress={handleMessage} disabled={messaging} style={[styles.messageButton, { opacity: messaging ? 0.6 : 1 }]}>
              {messaging ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <IconSymbol name="paperplane.fill" size={16} color="#fff" />
                  <ThemedText style={styles.messageLabel} lightColor="#fff" darkColor="#fff">
                    Message
                  </ThemedText>
                </>
              )}
            </Pressable>
          )}

          {isOwner && (
            <Pressable onPress={() => router.push('/marketplace/editor')} style={styles.addListingButton}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <ThemedText style={styles.messageLabel} lightColor="#fff" darkColor="#fff">
                Add listing
              </ThemedText>
            </Pressable>
          )}

          <View style={styles.listingsSection}>
            <ThemedText style={styles.sectionLabel}>
              Listings{listings.length > 0 ? ` (${listings.length})` : ''}
            </ThemedText>
            {listings.length === 0 ? (
              <ThemedText style={styles.empty}>{isOwner ? 'No listings yet — add your first one.' : 'No active listings from this vendor.'}</ThemedText>
            ) : (
              <View style={styles.grid}>
                {listings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    tunnelUrl={session.hub.tunnelUrl}
                    token={session.token}
                    onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
                    style={styles.gridCard}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  identity: {
    alignItems: 'center',
    marginTop: 8,
    gap: 3,
  },
  name: {
    fontSize: 20,
    marginTop: 10,
  },
  meta: {
    fontSize: 13,
    opacity: 0.7,
  },
  joined: {
    fontSize: 12,
    opacity: 0.5,
  },
  bio: {
    fontSize: 14.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 16,
  },
  contactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 14,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 160,
  },
  contactLabel: {
    fontSize: 12,
    opacity: 0.7,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand,
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 20,
  },
  addListingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand,
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 20,
  },
  messageLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  listingsSection: {
    marginTop: 28,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  gridCard: {
    width: '48%',
  },
});
