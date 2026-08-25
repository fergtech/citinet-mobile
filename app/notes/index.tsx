import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteNote, listNotes, updateNote } from '@/lib/api/hubService';
import { HubNote } from '@/lib/api/types';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';
import { timeAgo } from '@/lib/ui/time-ago';

type Tab = 'notes' | 'archived';
type VisFilter = 'all' | 'private' | 'hub' | 'public';

function noteVisibility(note: HubNote): 'private' | 'hub' | 'public' {
  if (note.is_web_public) return 'public';
  if (note.is_public) return 'hub';
  return 'private';
}

// Labels match app/notes/[id].tsx's VISIBILITY_META — "Public link" rather
// than a bare "Public", so it doesn't read like it means "listed/discoverable"
// (that's blog publishing, a separate thing layered on top of this tier).
const VIS_FILTERS: { id: VisFilter; label: string; icon: IconSymbolName | null }[] = [
  { id: 'all', label: 'All', icon: null },
  { id: 'private', label: 'Only me', icon: 'lock.fill' },
  { id: 'hub', label: 'Hub members', icon: 'person.2.fill' },
  { id: 'public', label: 'Public link', icon: 'globe' },
];

function visibilityMeta(note: HubNote): { icon: 'lock.fill' | 'person.2.fill' | 'globe'; label: string } {
  const v = noteVisibility(note);
  return v === 'public'
    ? { icon: 'globe', label: 'Public link' }
    : v === 'hub'
      ? { icon: 'person.2.fill', label: 'Hub members' }
      : { icon: 'lock.fill', label: 'Only me' };
}

export default function NotesListScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { status, attention, ensure, decryptNote } = useE2EKeys();

  const [tab, setTab] = useState<Tab>('notes');
  const [query, setQuery] = useState('');
  const [visFilter, setVisFilter] = useState<VisFilter>('all');
  const [active, setActive] = useState<HubNote[] | null>(null);
  const [archived, setArchived] = useState<HubNote[] | null>(null);
  const [snippets, setSnippets] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensure();
  }, [ensure]);

  useEffect(() => {
    if (attention) router.push((attention === 'unlock' ? '/e2e-unlock' : '/e2e-setup') as Href);
  }, [attention]);

  const load = useCallback(
    (which: Tab) => {
      if (!session || status !== 'ready') return;
      setLoading(true);
      setError(null);
      listNotes(session.hub.tunnelUrl, session.token, which === 'archived')
        .then(which === 'archived' ? setArchived : setActive)
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load notes.'))
        .finally(() => setLoading(false));
    },
    [session, status]
  );

  // Reload the active tab every time this screen gains focus — covers the
  // first mount and, importantly, coming back from creating/editing a note.
  useFocusEffect(
    useCallback(() => {
      if (status === 'ready') load(tab);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, tab])
  );

  const list = tab === 'notes' ? active : archived;

  // Decrypt snippets for whichever list is currently loaded/visible.
  useEffect(() => {
    if (!list) return;
    let cancelled = false;
    (async () => {
      const next = new Map(snippets);
      for (const note of list) {
        if (next.has(note.id)) continue;
        const body = await decryptNote(note.body_plain);
        next.set(note.id, body?.plain ?? "🔒 Couldn't decrypt");
      }
      if (!cancelled) setSnippets(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, decryptNote]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    return list
      .filter((n) => visFilter === 'all' || noteVisibility(n) === visFilter)
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (snippets.get(n.id) ?? '').toLowerCase().includes(q));
  }, [list, query, snippets, visFilter]);

  const pinned = tab === 'notes' ? filtered.filter((n) => n.is_pinned) : [];
  const rest = tab === 'notes' ? filtered.filter((n) => !n.is_pinned) : filtered;

  function togglePin(note: HubNote) {
    if (!session) return;
    setActive((prev) => prev?.map((n) => (n.id === note.id ? { ...n, is_pinned: !n.is_pinned } : n)) ?? prev);
    updateNote(session.hub.tunnelUrl, session.token, note.id, { is_pinned: !note.is_pinned }).catch(() => {
      setActive((prev) => prev?.map((n) => (n.id === note.id ? { ...n, is_pinned: note.is_pinned } : n)) ?? prev);
    });
  }

  function toggleArchive(note: HubNote) {
    if (!session) return;
    const nextArchived = !note.is_archived;
    const removeFrom = note.is_archived ? setArchived : setActive;
    const addTo = nextArchived ? setArchived : setActive;
    removeFrom((prev) => prev?.filter((n) => n.id !== note.id) ?? prev);
    updateNote(session.hub.tunnelUrl, session.token, note.id, { is_archived: nextArchived })
      .then(() => {
        addTo((prev) => (prev ? [{ ...note, is_archived: nextArchived }, ...prev] : prev));
      })
      .catch(() => load(tab));
  }

  function removeFromLists(id: string) {
    setActive((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    setArchived((prev) => prev?.filter((n) => n.id !== id) ?? prev);
  }

  function confirmDelete(note: HubNote) {
    if (!session) return;
    confirmDestructive('Delete this note?', 'Delete', () => {
      removeFromLists(note.id);
      deleteNote(session.hub.tunnelUrl, session.token, note.id).catch(() => load(tab));
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
          <IconSymbol name="chevron.left" size={24} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.title}>
          Notes
        </ThemedText>
        <Pressable
          onPress={() => router.push({ pathname: '/notes/[id]', params: { id: 'new' } })}
          hitSlop={12}
          disabled={status !== 'ready'}
          style={{ opacity: status === 'ready' ? 1 : 0.3 }}
          accessibilityLabel="New note"
          accessibilityRole="button">
          <IconSymbol name="plus" size={24} color={Colors[colorScheme].text} />
        </Pressable>
      </View>

      {status === 'idle' || status === 'checking' ? (
        <ActivityIndicator style={styles.spinner} />
      ) : status !== 'ready' ? (
        <View style={styles.lockedBox}>
          <IconSymbol name="lock.shield.fill" size={28} color={Colors[colorScheme].icon} />
          <ThemedText style={styles.lockedTitle}>Notes are encrypted</ThemedText>
          <ThemedText style={styles.lockedBody}>
            Set up or unlock encryption on this device to read and write notes.
          </ThemedText>
          <Pressable onPress={() => router.push('/account/privacy')} style={styles.lockedButton}>
            <ThemedText style={styles.lockedButtonLabel} lightColor="#fff" darkColor="#fff">
              Go to Privacy & Security
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        // A tap anywhere in here that isn't itself a touchable (the search
        // input, a tab, a row) dismisses the keyboard — otherwise it was
        // stuck open with no way to close it short of tapping a note.
        <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
          <View style={styles.searchRow}>
            <IconSymbol name="magnifyingglass" size={17} color={Colors[colorScheme].icon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search notes"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.searchInput, { color: Colors[colorScheme].text }]}
            />
          </View>

          <View style={styles.tabs}>
            {(['notes', 'archived'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: Brand }]}>
                <ThemedText style={[styles.tabLabel, tab === t && { color: Brand, fontWeight: '600' }]}>
                  {t === 'notes' ? 'Notes' : 'Archived'}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {/* Fixed-height wrapper around the horizontal ScrollView, same
              pattern as Discover's tab row — a horizontal ScrollView's own
              reported height isn't reliable everywhere (collapses on
              react-native-web), so the row's height is enforced from
              outside it rather than trusted from the ScrollView itself. */}
          <View style={styles.visFilterRowWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.visFilterRow}>
              {VIS_FILTERS.map((f) => {
                const active = visFilter === f.id;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => setVisFilter(f.id)}
                    style={[styles.visChip, active && { backgroundColor: Brand }]}>
                    {f.icon && <IconSymbol name={f.icon} size={12} color={active ? '#fff' : Colors[colorScheme].icon} />}
                    <ThemedText style={styles.visChipLabel} lightColor={active ? '#fff' : undefined} darkColor={active ? '#fff' : undefined}>
                      {f.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {loading && !list && <ActivityIndicator style={styles.spinner} />}
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <FlatList
            data={tab === 'notes' ? rest : filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onRefresh={() => load(tab)}
            refreshing={loading}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              tab === 'notes' && pinned.length > 0 ? (
                <>
                  <ThemedText style={styles.sectionLabel}>Pinned</ThemedText>
                  {pinned.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      snippet={snippets.get(note.id)}
                      onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
                      onPin={() => togglePin(note)}
                      onArchive={() => toggleArchive(note)}
                      onDelete={() => confirmDelete(note)}
                    />
                  ))}
                  <ThemedText style={styles.sectionLabel}>All notes</ThemedText>
                </>
              ) : null
            }
            renderItem={({ item }) => (
              <NoteRow
                note={item}
                snippet={snippets.get(item.id)}
                onPress={() => router.push({ pathname: '/notes/[id]', params: { id: item.id } })}
                onPin={() => togglePin(item)}
                onArchive={() => toggleArchive(item)}
                onDelete={() => confirmDelete(item)}
              />
            )}
            ListEmptyComponent={
              !loading ? (
                <ThemedText style={styles.empty}>
                  {query.trim()
                    ? 'No notes match your search.'
                    : visFilter !== 'all'
                      ? `No notes set to "${VIS_FILTERS.find((f) => f.id === visFilter)?.label}".`
                      : tab === 'archived'
                        ? 'No archived notes.'
                        : 'No notes yet.'}
                </ThemedText>
              ) : null
            }
          />
        </Pressable>
      )}
    </ThemedView>
  );
}

function NoteRow({
  note,
  snippet,
  onPress,
  onPin,
  onArchive,
  onDelete,
}: {
  note: HubNote;
  snippet: string | undefined;
  onPress: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const vis = visibilityMeta(note);
  return (
    <Pressable onPress={onPress} onLongPress={onDelete} style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.rowTitle}>
          {note.title || 'Untitled'}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.rowSnippet}>
          {snippet ?? '…'}
        </ThemedText>
        <View style={styles.rowMeta}>
          <IconSymbol name={vis.icon} size={12} color={Colors[colorScheme].icon} />
          <ThemedText style={styles.rowMetaText}>
            {vis.label} · {timeAgo(note.updated_at)}
          </ThemedText>
        </View>
      </View>
      <Pressable onPress={onPin} hitSlop={10}>
        <IconSymbol name="pin.fill" size={18} color={note.is_pinned ? Brand : Colors[colorScheme].icon} />
      </Pressable>
      {!note.is_pinned && (
        <Pressable onPress={onArchive} hitSlop={10}>
          <IconSymbol name="archivebox.fill" size={18} color={Colors[colorScheme].icon} />
        </Pressable>
      )}
    </Pressable>
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
  title: {
    fontSize: 17,
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
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    marginBottom: 4,
  },
  tab: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  visFilterRowWrap: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  visFilterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  visChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  visChipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 24,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowSnippet: {
    fontSize: 13,
    opacity: 0.6,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  rowMetaText: {
    fontSize: 11.5,
    opacity: 0.5,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
    marginTop: 16,
  },
  lockedBox: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    gap: 8,
  },
  lockedTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  lockedBody: {
    textAlign: 'center',
    opacity: 0.6,
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 8,
  },
  lockedButton: {
    backgroundColor: Brand,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  lockedButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
