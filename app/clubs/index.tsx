import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listAllClubs, listMyClubs, clubBannerUrl } from '@/lib/api/hubService';
import { Club } from '@/lib/api/types';
import { CLUB_CATEGORY_FILTERS, clubCategoryMeta, clubMonogramColor, clubVisibilityMeta, type ClubCategory } from '@/lib/clubs/meta';
import { useSession } from '@/lib/session/session-context';

// Mirrors citinet web's SpacesScreen — a Discover/Joined toggle plus category
// filters over GET /api/spaces (every club on the hub) vs GET /api/spaces/mine
// (active memberships only) — still those literal server routes (see
// hubService's own ── Clubs ── note; renamed client-side only). Neither of
// those two full lists had anywhere to live on mobile before this screen:
// app/clubs/[slug].tsx (the detail view) is only ever reached today via
// search results, the "Your clubs" strip, or a direct link — there was no
// way to browse clubs you haven't joined yet.

function ClubAvatar({ club, tunnelUrl }: { club: Club; tunnelUrl: string }) {
  const category = clubCategoryMeta(club.category);
  return (
    <View style={styles.avatarWrap}>
      <View style={styles.avatar}>
        {club.banner_mode === 'image' && club.banner_image_file_name ? (
          <Image source={{ uri: clubBannerUrl(tunnelUrl, club.slug) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : club.banner_mode === 'gradient' && club.banner_gradient_from && club.banner_gradient_to ? (
          <LinearGradient
            colors={[club.banner_gradient_from, club.banner_gradient_to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: clubMonogramColor(club) }]} />
        )}
        {/* Faint scrim so the letter stays legible over a banner photo —
            matches web's own bg-black/10 treatment on this same row avatar. */}
        <View style={[StyleSheet.absoluteFill, styles.avatarScrim]} />
        <ThemedText style={styles.avatarLetter} lightColor="#fff" darkColor="#fff">
          {club.name.charAt(0).toUpperCase()}
        </ThemedText>
      </View>
      {category && (
        <View style={styles.categoryBadge}>
          <IconSymbol name={category.icon} size={10} color="#fff" />
        </View>
      )}
    </View>
  );
}

function ClubRow({ club, tunnelUrl }: { club: Club; tunnelUrl: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const visibility = clubVisibilityMeta(club.visibility);
  const memberCount = Number(club.member_count) || 0;
  const onlineCount = club.online_count || 0;

  return (
    <Pressable style={styles.row} onPress={() => router.push({ pathname: '/clubs/[slug]', params: { slug: club.slug } })}>
      <ClubAvatar club={club} tunnelUrl={tunnelUrl} />
      <View style={styles.rowContent}>
        <View style={styles.nameLine}>
          <ThemedText type="defaultSemiBold" style={styles.name} numberOfLines={1}>
            {club.name}
          </ThemedText>
          <IconSymbol name={visibility.icon} size={12} color={Colors[colorScheme].icon} style={styles.visibilityIcon} />
        </View>
        <ThemedText style={styles.rowMeta} numberOfLines={1}>
          {club.description?.trim() || `${memberCount} ${memberCount === 1 ? 'neighbor' : 'neighbors'}`}
        </ThemedText>
        <View style={styles.statsLine}>
          {!!club.description?.trim() && (
            <ThemedText style={styles.statsText}>
              {memberCount} {memberCount === 1 ? 'neighbor' : 'neighbors'}
            </ThemedText>
          )}
          {onlineCount > 0 && (
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <ThemedText style={styles.onlineText}>{onlineCount} online</ThemedText>
            </View>
          )}
        </View>
        {club.my_status === 'pending' && <ThemedText style={styles.pendingText}>Pending approval</ThemedText>}
        {club.my_status === 'invited' && <ThemedText style={[styles.invitedText, { color: Brand }]}>Invited — tap to accept</ThemedText>}
      </View>
    </Pressable>
  );
}

export default function ClubsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const [myClubs, setMyClubs] = useState<Club[]>([]);
  const [allClubs, setAllClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<ClubCategory | 'all'>('all');

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([listMyClubs(session.hub.tunnelUrl, session.token), listAllClubs(session.hub.tunnelUrl, session.token)])
      .then(([mine, all]) => {
        setMyClubs(mine);
        setAllClubs(all);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load clubs."))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  const displayClubs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (showAll ? allClubs : myClubs)
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .filter((s) => categoryFilter === 'all' || s.category === categoryFilter);
  }, [showAll, allClubs, myClubs, search, categoryFilter]);

  // Invited-but-not-yet-accepted clubs only ever come back from the full
  // Discover list (listMyClubs only returns active memberships) — surfaced
  // here regardless of which tab is showing, same as web's own banner.
  const pendingInvites = useMemo(() => allClubs.filter((s) => s.my_status === 'invited'), [allClubs]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Clubs" rightIcon="plus" onRightPress={() => router.push('/clubs/create')} rightAccessibilityLabel="Create a club" />

      {loading && myClubs.length === 0 && allClubs.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={displayClubs}
        keyExtractor={(item) => item.id}
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item }) => <ClubRow club={item} tunnelUrl={session.hub.tunnelUrl} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.filters}>
            <View style={styles.searchRow}>
              <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search clubs"
                placeholderTextColor={Colors[colorScheme].icon}
                style={[styles.searchInput, { color: Colors[colorScheme].text }]}
              />
            </View>

            <View style={styles.toggleRow}>
              <Pressable onPress={() => setShowAll(true)} style={[styles.toggleBtn, showAll && { backgroundColor: Colors[colorScheme].text }]}>
                <ThemedText style={styles.toggleLabel} lightColor={showAll ? Colors.light.background : undefined} darkColor={showAll ? Colors.dark.background : undefined}>
                  Discover
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => setShowAll(false)} style={[styles.toggleBtn, !showAll && { backgroundColor: Colors[colorScheme].text }]}>
                <ThemedText style={styles.toggleLabel} lightColor={!showAll ? Colors.light.background : undefined} darkColor={!showAll ? Colors.dark.background : undefined}>
                  Joined{myClubs.length > 0 ? ` (${myClubs.length})` : ''}
                </ThemedText>
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Pressable onPress={() => setCategoryFilter('all')} style={[styles.chip, categoryFilter === 'all' && { backgroundColor: Brand }]}>
                <ThemedText style={styles.chipLabel} lightColor={categoryFilter === 'all' ? '#fff' : undefined} darkColor={categoryFilter === 'all' ? '#fff' : undefined}>
                  All
                </ThemedText>
              </Pressable>
              {CLUB_CATEGORY_FILTERS.filter((f) => f.value !== 'all').map((f) => {
                const active = categoryFilter === f.value;
                const meta = clubCategoryMeta(f.value);
                return (
                  <Pressable key={f.value} onPress={() => setCategoryFilter(f.value as ClubCategory)} style={[styles.chip, active && { backgroundColor: Brand }]}>
                    {meta && <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />}
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {f.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {!showAll && pendingInvites.length > 0 && (
              <View style={styles.invitesBanner}>
                <ThemedText style={[styles.invitesBannerTitle, { color: Brand }]}>
                  You have {pendingInvites.length} invite{pendingInvites.length > 1 ? 's' : ''}
                </ThemedText>
                {pendingInvites.map((s) => (
                  <Pressable
                    key={s.id}
                    style={styles.invitesBannerRow}
                    onPress={() => router.push({ pathname: '/clubs/[slug]', params: { slug: s.slug } })}>
                    <IconSymbol name="chevron.right" size={13} color={Brand} />
                    <ThemedText style={styles.invitesBannerRowLabel}>{s.name}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <IconSymbol name="square.grid.2x2" size={22} color={Colors[colorScheme].icon} />
              </View>
              <ThemedText type="defaultSemiBold" style={styles.emptyTitle}>
                {showAll ? 'No clubs on this hub yet' : 'No clubs joined yet'}
              </ThemedText>
              <ThemedText style={styles.emptySubtitle}>
                {showAll ? 'Be the first to create one.' : 'Switch to Discover to find clubs to join.'}
              </ThemedText>
            </View>
          ) : null
        }
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
  filters: {
    paddingBottom: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#8881',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 3,
    borderRadius: 10,
    backgroundColor: '#8881',
    marginBottom: 10,
  },
  toggleBtn: {
    flex: 1,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  chipLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  invitesBanner: {
    borderRadius: 12,
    backgroundColor: Brand + '14',
    padding: 12,
    marginBottom: 10,
  },
  invitesBannerTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    marginBottom: 4,
  },
  invitesBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  invitesBannerRowLabel: {
    fontSize: 13.5,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarScrim: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  avatarLetter: {
    fontSize: 17,
    fontWeight: '700',
  },
  categoryBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 17,
    height: 17,
    borderRadius: 6,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#8884',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    flex: 1,
    fontSize: 15.5,
  },
  visibilityIcon: {
    opacity: 0.6,
  },
  rowMeta: {
    fontSize: 12.5,
    opacity: 0.6,
  },
  statsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 1,
  },
  statsText: {
    fontSize: 11,
    opacity: 0.5,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  onlineText: {
    fontSize: 11,
    color: '#16a34a',
    fontWeight: '600',
  },
  pendingText: {
    fontSize: 11.5,
    color: '#d97706',
    marginTop: 2,
  },
  invitedText: {
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 14.5,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12.5,
    opacity: 0.6,
    textAlign: 'center',
  },
});
