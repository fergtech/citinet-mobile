import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initiativeBannerUrl, listInitiatives } from '@/lib/api/hubService';
import { Initiative } from '@/lib/api/types';
import {
  INITIATIVE_CATEGORY_ORDER,
  INITIATIVE_STATUS_META,
  INITIATIVE_STATUS_ORDER,
  initiativeCategoryMeta,
  initiativeCategoryPresetImage,
  initiativeColor,
  initiativeMemberCount,
  initiativeOpenRoleCount,
  initiativeProgress,
  initiativeStatusMeta,
  initiativeTaskCounts,
} from '@/lib/initiatives/meta';
import { useSession } from '@/lib/session/session-context';

type StatusFilter = 'All' | string;
type CategoryFilter = 'All' | string;

function InitiativeRow({ initiative, tunnelUrl }: { initiative: Initiative; tunnelUrl: string }) {
  const category = initiativeCategoryMeta(initiative.category);
  const status = initiativeStatusMeta(initiative.status);
  const color = initiativeColor(initiative.color);
  const counts = initiativeTaskCounts(initiative);
  const progress = initiativeProgress(initiative);
  const memberCount = initiativeMemberCount(initiative);
  const openRoleCount = initiativeOpenRoleCount(initiative);
  const hasBannerImage = initiative.banner_mode === 'image' && !!initiative.banner_image_file_name;
  const presetImage = initiativeCategoryPresetImage(initiative.category);

  return (
    <Pressable
      style={styles.row}
      // `as Href` — app/initiatives/[id].tsx (the detail screen) doesn't
      // exist yet, so expo-router's typed routes don't know this path yet.
      // Drop the cast once that screen is built.
      onPress={() => router.push({ pathname: '/initiatives/[id]', params: { id: initiative.id } } as unknown as Href)}>
      <View style={[styles.tile, { backgroundColor: color }]}>
        {hasBannerImage ? (
          <Image source={{ uri: initiativeBannerUrl(tunnelUrl, initiative.id) }} style={styles.tileImage} contentFit="cover" />
        ) : presetImage ? (
          <Image source={presetImage} style={styles.tileImage} contentFit="cover" />
        ) : (
          <IconSymbol name={category.icon} size={19} color="#fff" />
        )}
      </View>
      <View style={styles.rowContent}>
        <View style={styles.statusLine}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <ThemedText style={[styles.statusLabel, { color: status.color }]}>{status.label}</ThemedText>
          <ThemedText style={styles.rowMeta}>
            {' '}
            · {category.label} · {memberCount} {memberCount === 1 ? 'neighbor' : 'neighbors'}
          </ThemedText>
        </View>
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1}>
          {initiative.title}
        </ThemedText>
        {!!initiative.goal && (
          <ThemedText style={styles.goal} numberOfLines={2}>
            {initiative.goal}
          </ThemedText>
        )}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
          </View>
          <ThemedText style={styles.progressPct}>{Math.round(progress * 100)}%</ThemedText>
        </View>
        <View style={styles.footerRow}>
          <ThemedText style={styles.rowMeta}>
            {counts.done} of {counts.total} tasks done
          </ThemedText>
          {openRoleCount > 0 ? (
            <ThemedText style={[styles.footerAccent, { color: Brand }]}>
              {openRoleCount} open {openRoleCount === 1 ? 'role' : 'roles'}
            </ThemedText>
          ) : (
            <ThemedText style={styles.rowMeta}>Team is full</ThemedText>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function InitiativesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [onlyMine, setOnlyMine] = useState(false);

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listInitiatives(session.hub.tunnelUrl, session.token)
      .then(setInitiatives)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load initiatives."))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  const filtered = useMemo(() => {
    let next = initiatives;
    if (onlyMine) next = next.filter((i) => i.viewerIsMember);
    if (statusFilter !== 'All') next = next.filter((i) => i.status === statusFilter);
    if (categoryFilter !== 'All') next = next.filter((i) => i.category === categoryFilter);
    return next;
  }, [initiatives, onlyMine, statusFilter, categoryFilter]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Initiatives" />

      {loading && initiatives.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item }) => <InitiativeRow initiative={item} tunnelUrl={session.hub.tunnelUrl} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.filters}>
            <Pressable
              onPress={() => setOnlyMine((v) => !v)}
              style={[styles.mineToggle, onlyMine && { backgroundColor: Brand }]}>
              <IconSymbol name="person.fill" size={13} color={onlyMine ? '#fff' : Colors[colorScheme].icon} />
              <ThemedText style={styles.chipLabel} lightColor={onlyMine ? '#fff' : undefined} darkColor={onlyMine ? '#fff' : undefined}>
                My initiatives
              </ThemedText>
            </Pressable>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Pressable
                onPress={() => setStatusFilter('All')}
                style={[styles.chip, statusFilter === 'All' && { backgroundColor: Brand }]}>
                <ThemedText
                  style={styles.chipLabel}
                  lightColor={statusFilter === 'All' ? '#fff' : undefined}
                  darkColor={statusFilter === 'All' ? '#fff' : undefined}>
                  All
                </ThemedText>
              </Pressable>
              {INITIATIVE_STATUS_ORDER.map((s) => {
                const meta = INITIATIVE_STATUS_META[s];
                const active = statusFilter === s;
                return (
                  <Pressable key={s} onPress={() => setStatusFilter(s)} style={[styles.chip, active && { backgroundColor: meta.color }]}>
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {meta.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Pressable
                onPress={() => setCategoryFilter('All')}
                style={[styles.chip, styles.chipOutline, categoryFilter === 'All' && { backgroundColor: Brand }]}>
                <ThemedText
                  style={styles.chipLabel}
                  lightColor={categoryFilter === 'All' ? '#fff' : undefined}
                  darkColor={categoryFilter === 'All' ? '#fff' : undefined}>
                  All
                </ThemedText>
              </Pressable>
              {INITIATIVE_CATEGORY_ORDER.map((cat) => {
                const meta = initiativeCategoryMeta(cat);
                const active = categoryFilter === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategoryFilter(cat)}
                    style={[styles.chip, styles.chipOutline, active && { backgroundColor: Brand }]}>
                    <IconSymbol name={meta.icon} size={13} color={active ? '#fff' : Colors[colorScheme].icon} />
                    <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {meta.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            <ThemedText style={styles.count}>
              {filtered.length} {filtered.length === 1 ? 'initiative' : 'initiatives'}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <ThemedText style={styles.empty}>
              {onlyMine ? "You haven't joined any initiatives that match these filters." : 'No initiatives match those filters yet.'}
            </ThemedText>
          ) : null
        }
        ListFooterComponent={
          filtered.length > 0 ? (
            <View style={styles.footerNote}>
              <IconSymbol name="target" size={14} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.footerNoteText}>Anyone in the hub can start an initiative</ThemedText>
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
  mineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: '#8881',
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
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
  chipOutline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  chipLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  count: {
    fontSize: 11.5,
    opacity: 0.5,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
    marginBottom: 6,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
  },
  tile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  tileImage: {
    ...StyleSheet.absoluteFillObject,
  },
  rowContent: {
    flex: 1,
    gap: 3,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  title: {
    fontSize: 16.5,
  },
  goal: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.75,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#8882',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressPct: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
    opacity: 0.6,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  footerAccent: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
  },
  footerNoteText: {
    fontSize: 12,
    opacity: 0.55,
  },
});
