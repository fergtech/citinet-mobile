import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';

import { FileRow } from '@/components/files/file-row';
import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listFiles, listMembers } from '@/lib/api/hubService';
import { HubFile, HubMember } from '@/lib/api/types';
import { formatBytes } from '@/lib/files/kind';
import { useStarredFiles } from '@/lib/files/starred-files';
import { useSession } from '@/lib/session/session-context';

type FilterTab = 'all' | 'mine' | 'shared' | 'starred';
type SortKey = 'recent' | 'name' | 'size';

const NEXT_SORT: Record<SortKey, SortKey> = { recent: 'name', name: 'size', size: 'recent' };
const SORT_LABEL: Record<SortKey, string> = { recent: 'Recent', name: 'Name', size: 'Size' };

export default function FilesListScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { isStarred, toggleStarred } = useStarredFiles();

  const [files, setFiles] = useState<HubFile[]>([]);
  const [members, setMembers] = useState<Map<string, HubMember>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  const load = useCallback(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listFiles(session.hub.tunnelUrl, session.token),
      listMembers(session.hub.tunnelUrl, session.token).catch(() => []),
    ])
      .then(([nextFiles, nextMembers]) => {
        setFiles(nextFiles);
        setMembers(new Map(nextMembers.map((m) => [m.user_id, m])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load files."))
      .finally(() => setLoading(false));
  }, [session]);

  useFocusEffect(load);

  const uploaderName = useCallback(
    (ownerId: string) => members.get(ownerId)?.display_name || members.get(ownerId)?.username || '',
    [members]
  );

  const filtered = useMemo(() => {
    let next = files;
    if (tab === 'mine') next = next.filter((f) => f.owner_id === session?.userId);
    else if (tab === 'shared') next = next.filter((f) => f.is_public || f.web_public);
    else if (tab === 'starred') next = next.filter((f) => isStarred(f.file_id));

    const q = query.trim().toLowerCase();
    if (q) {
      next = next.filter((f) => f.file_name.toLowerCase().includes(q) || uploaderName(f.owner_id).toLowerCase().includes(q));
    }

    const sorted = [...next];
    if (sort === 'recent') sorted.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
    else if (sort === 'name') sorted.sort((a, b) => a.file_name.localeCompare(b.file_name));
    else sorted.sort((a, b) => b.size_bytes - a.size_bytes);
    return sorted;
  }, [files, tab, query, sort, session, isStarred, uploaderName]);

  const totalSize = useMemo(() => filtered.reduce((sum, f) => sum + (f.size_bytes || 0), 0), [filtered]);

  if (!session) return null;

  const emptyMessage = query.trim()
    ? 'No files match your search.'
    : tab === 'starred'
      ? "Nothing starred yet — tap a file's star to keep it handy here."
      : tab === 'mine'
        ? "You haven't uploaded anything yet."
        : tab === 'shared'
          ? 'Nothing shared with the hub yet.'
          : 'No files in the hub yet.';

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader
        title="Files"
        rightIcon="plus"
        onRightPress={() => router.push('/files/upload' as Href)}
        rightAccessibilityLabel="Upload a file"
        rightIcon2="externaldrive.fill"
        onRightPress2={() => router.push('/files/storage' as Href)}
        rightAccessibilityLabel2="Storage"
      />

      {loading && files.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
        <View style={styles.searchRow}>
          <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search files"
            placeholderTextColor={Colors[colorScheme].icon}
            style={[styles.searchInput, { color: Colors[colorScheme].text }]}
          />
        </View>

        {/* Fixed-height wrapper around the horizontal ScrollView — its own
            reported height isn't reliable on its own (same fix already
            applied to Notes' visFilterRowWrap/Discover's tab row), so the
            row's height is enforced from outside it. Without this, the chip
            row could expand to fill the flex column's remaining space
            instead of hugging its content, pushing everything below it down
            and leaving a large blank gap. */}
        <View style={styles.chipsRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {(
              [
                { id: 'all', label: 'All files' },
                { id: 'mine', label: 'My uploads' },
                { id: 'shared', label: 'Shared' },
                { id: 'starred', label: 'Starred' },
              ] as { id: FilterTab; label: string }[]
            ).map((f) => {
              const active = tab === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setTab(f.id)}
                  style={[styles.chip, active && { backgroundColor: Colors[colorScheme].tint }]}>
                  <ThemedText style={styles.chipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                    {f.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.countRow}>
          <ThemedText style={styles.countText}>
            {filtered.length} {filtered.length === 1 ? 'file' : 'files'} · {formatBytes(totalSize)}
          </ThemedText>
          <Pressable onPress={() => setSort(NEXT_SORT[sort])} style={styles.sortButton}>
            <ThemedText style={styles.sortLabel}>Sort: {SORT_LABEL[sort]}</ThemedText>
          </Pressable>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.file_id}
          style={styles.listFlex}
          contentContainerStyle={styles.list}
          onRefresh={load}
          refreshing={loading}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <FileRow
              file={item}
              starred={isStarred(item.file_id)}
              onPress={() => router.push({ pathname: '/files/[id]', params: { id: item.file_id } })}
              onToggleStar={() => toggleStarred(item.file_id)}
            />
          )}
          ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>{emptyMessage}</ThemedText> : null}
          ListFooterComponent={
            filtered.length > 0 ? (
              <ThemedText style={styles.footer}>Stored on your hub, never on an outside service.</ThemedText>
            ) : null
          }
        />
      </Pressable>
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
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
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
  chipsRowWrap: {
    paddingBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    marginBottom: 4,
  },
  countText: {
    fontSize: 12,
    opacity: 0.6,
  },
  sortButton: {
    paddingVertical: 4,
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
  footer: {
    opacity: 0.45,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
});
