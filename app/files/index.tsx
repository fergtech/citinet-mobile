import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';

import { ActionSheet, type ActionSheetOption } from '@/components/action-sheet';
import { FileRow } from '@/components/files/file-row';
import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createFolder, listFiles, listFolders, listMembers, moveFileToFolder } from '@/lib/api/hubService';
import { HubFile, HubFolder, HubMember } from '@/lib/api/types';
import { formatBytes } from '@/lib/files/kind';
import { useStarredFiles } from '@/lib/files/starred-files';
import { useSession } from '@/lib/session/session-context';

type FilterTab = 'all' | 'mine' | 'shared' | 'starred';
type SortKey = 'recent' | 'name' | 'size';

const NEXT_SORT: Record<SortKey, SortKey> = { recent: 'name', name: 'size', size: 'recent' };
const SORT_LABEL: Record<SortKey, string> = { recent: 'Recent', name: 'Name', size: 'Size' };

// Solid representative colors for each folder color key — matches the set
// citinet web offers when creating a folder (hub_folders.color is a shared
// string column, so the two clients need to agree on the same key names).
const FOLDER_COLORS: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  emerald: '#059669',
  purple: '#7c3aed',
  rose: '#e11d48',
  cyan: '#0891b2',
  slate: '#64748b',
};
const FOLDER_COLOR_KEYS = Object.keys(FOLDER_COLORS);

export default function FilesListScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { isStarred, toggleStarred } = useStarredFiles();
  // Home's "Latest upload" preview only surfaces is_public/web_public files
  // (see index.tsx's latestPublicFile), so its "See all" deep-links straight
  // into the matching Shared tab instead of dropping the viewer on All.
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();

  const [files, setFiles] = useState<HubFile[]>([]);
  const [members, setMembers] = useState<Map<string, HubMember>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>(() =>
    initialTab === 'mine' || initialTab === 'shared' || initialTab === 'starred' ? initialTab : 'all'
  );
  const [sort, setSort] = useState<SortKey>('recent');

  // ── folders ──────────────────────────────────────────────────────────────
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<HubFolder[]>([]);
  const [folders, setFolders] = useState<HubFolder[]>([]);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState<string>('amber');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderError, setNewFolderError] = useState('');
  const [moveFile, setMoveFile] = useState<HubFile | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

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

  // fetch the child folders of the currently open folder (null = dashboard root)
  const fetchFolders = useCallback(() => {
    if (!session) return;
    listFolders(session.hub.tunnelUrl, session.token, currentFolderId)
      .then(setFolders)
      .catch(() => {}); // folder grid is supplemental — the file list still works without it
  }, [session, currentFolderId]);

  useEffect(fetchFolders, [fetchFolders]);

  const uploaderName = useCallback(
    (ownerId: string) => members.get(ownerId)?.display_name || members.get(ownerId)?.username || '',
    [members]
  );

  // Files only ever show inside the folder they're actually in — the same
  // scoping citinet web's FilesScreen applies before its own tab/search/sort.
  const folderScopedFiles = useMemo(
    () => files.filter((f) => (f.folder_id ?? null) === currentFolderId),
    [files, currentFolderId]
  );

  const filtered = useMemo(() => {
    let next = folderScopedFiles;
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
  }, [folderScopedFiles, tab, query, sort, session, isStarred, uploaderName]);

  const totalSize = useMemo(() => filtered.reduce((sum, f) => sum + (f.size_bytes || 0), 0), [filtered]);

  // ── folder navigation ────────────────────────────────────────────────────
  const openFolder = useCallback((folder: HubFolder) => {
    setFolderPath((prev) => [...prev, folder]);
    setCurrentFolderId(folder.id);
  }, []);

  // index -1 jumps to the dashboard root ("All files")
  const jumpToFolder = useCallback((index: number) => {
    if (index < 0) {
      setFolderPath([]);
      setCurrentFolderId(null);
      return;
    }
    setFolderPath((prev) => {
      const next = prev.slice(0, index + 1);
      setCurrentFolderId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(() => {
    const name = newFolderName.trim();
    if (!name || !session) return;
    setCreatingFolder(true);
    setNewFolderError('');
    createFolder(session.hub.tunnelUrl, session.token, name, newFolderColor, currentFolderId)
      .then((folder) => {
        setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
        setShowNewFolderModal(false);
        setNewFolderName('');
        setNewFolderColor('amber');
      })
      .catch((err) => setNewFolderError(err instanceof Error ? err.message : "Couldn't create that folder."))
      .finally(() => setCreatingFolder(false));
  }, [newFolderName, newFolderColor, currentFolderId, session]);

  const handleMoveFile = useCallback(
    (file: HubFile, folderId: string | null) => {
      if (!session) return;
      setMoveFile(null);
      setMovingId(file.file_id);
      moveFileToFolder(session.hub.tunnelUrl, session.token, file.file_name, folderId)
        .then(() => {
          setFiles((prev) => prev.map((f) => (f.file_id === file.file_id ? { ...f, folder_id: folderId } : f)));
          fetchFolders(); // refresh source/destination folder file_counts
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't move that file."))
        .finally(() => setMovingId(null));
    },
    [session, fetchFolders]
  );

  if (!session) return null;

  const emptyMessage = query.trim()
    ? 'No files match your search.'
    : tab === 'starred'
      ? "Nothing starred yet — tap a file's star to keep it handy here."
      : tab === 'mine'
        ? "You haven't uploaded anything yet."
        : tab === 'shared'
          ? 'Nothing shared with the hub yet.'
          : currentFolderId
            ? 'This folder is empty.'
            : 'No files in the hub yet.';

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader
        title="Files"
        rightIcon="plus"
        onRightPress={() =>
          router.push(
            (currentFolderId
              ? { pathname: '/files/upload', params: { folderId: currentFolderId, folderName: folderPath[folderPath.length - 1]?.name } }
              : '/files/upload') as Href
          )
        }
        rightAccessibilityLabel="Upload a file"
        rightIcon2="externaldrive.fill"
        onRightPress2={() => router.push('/files/storage' as Href)}
        rightAccessibilityLabel2="Storage"
        rightIcon3="folder.badge.plus"
        onRightPress3={() => setShowNewFolderModal(true)}
        rightAccessibilityLabel3="New folder"
      />

      {loading && files.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {/* Backdrop dismisses the keyboard on any tap that isn't itself a
          touchable — a separate absolute-filled Pressable BEHIND the content
          (not wrapping it): react-native-web's Pressable calls
          preventDefault() on pointerdown, which blocks the browser's native
          focus-on-click for any TextInput nested inside it (this exact
          screen's search field went unclickable on web from that). The
          content View below sits on top with pointerEvents="box-none" so its
          own children (search field, chips, list) keep normal touch handling
          and only truly empty space falls through to this backdrop. */}
      <Pressable style={styles.backdrop} onPress={Keyboard.dismiss} />
      <View style={styles.flex} pointerEvents="box-none">
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

        {/* Breadcrumb — only shown once the viewer has drilled into a folder */}
        {folderPath.length > 0 && (
          <View style={styles.breadcrumbRow}>
            <Pressable onPress={() => jumpToFolder(-1)}>
              <ThemedText style={styles.breadcrumbLink}>All files</ThemedText>
            </Pressable>
            {folderPath.map((f, i) => (
              <View key={f.id} style={styles.breadcrumbCrumb}>
                <IconSymbol name="chevron.right" size={13} color={Colors[colorScheme].icon} />
                <Pressable onPress={() => jumpToFolder(i)} disabled={i === folderPath.length - 1}>
                  <ThemedText
                    style={styles.breadcrumbLink}
                    lightColor={i === folderPath.length - 1 ? Colors.light.text : undefined}
                    darkColor={i === folderPath.length - 1 ? Colors.dark.text : undefined}
                    numberOfLines={1}>
                    {f.name}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Folder grid — child folders of the current level */}
        {folders.length > 0 && (
          <View style={styles.folderGrid}>
            {folders.map((folder) => (
              <Pressable key={folder.id} onPress={() => openFolder(folder)} style={styles.folderCard}>
                <View style={[styles.folderIconWrap, { backgroundColor: FOLDER_COLORS[folder.color] || FOLDER_COLORS.amber }]}>
                  <IconSymbol name="folder.fill" size={17} color="#fff" />
                </View>
                <View style={styles.folderText}>
                  <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.folderName}>
                    {folder.name}
                  </ThemedText>
                  <ThemedText style={styles.folderMeta}>
                    {folder.file_count} {folder.file_count === 1 ? 'file' : 'files'}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        )}

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
                  style={[styles.chip, active && { backgroundColor: Brand }]}>
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
          renderItem={({ item }) => {
            const isOwner = item.owner_id === session.userId;
            const canMove = isOwner && (item.folder_id != null || folders.length > 0);
            return (
              <FileRow
                file={item}
                starred={isStarred(item.file_id)}
                tunnelUrl={session.hub.tunnelUrl}
                token={session.token}
                onPress={() => router.push({ pathname: '/files/[id]', params: { id: item.file_id } })}
                onToggleStar={() => toggleStarred(item.file_id)}
                onMove={canMove && movingId !== item.file_id ? () => setMoveFile(item) : undefined}
              />
            );
          }}
          ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>{emptyMessage}</ThemedText> : null}
          ListFooterComponent={
            filtered.length > 0 ? (
              <ThemedText style={styles.footer}>Stored on your hub, never on an outside service.</ThemedText>
            ) : null
          }
        />
      </View>

      {/* Move-to-folder action sheet — destinations are the folders visible
          at this level, same scope the file picker/breadcrumb already show. */}
      <ActionSheet
        visible={!!moveFile}
        onClose={() => setMoveFile(null)}
        options={
          moveFile
            ? [
                ...(moveFile.folder_id != null
                  ? [{ key: 'root', label: 'All files (root)', icon: 'house.fill', onPress: () => handleMoveFile(moveFile, null) } as ActionSheetOption]
                  : []),
                ...folders
                  .filter((f) => f.id !== moveFile.folder_id)
                  .map((f) => ({ key: f.id, label: f.name, icon: 'folder.fill', onPress: () => handleMoveFile(moveFile, f.id) }) as ActionSheetOption),
              ]
            : []
        }
      />

      {/* New folder modal */}
      <Modal visible={showNewFolderModal} transparent animationType="fade" onRequestClose={() => setShowNewFolderModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowNewFolderModal(false)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: Colors[colorScheme].background }]}>
            <ThemedText type="defaultSemiBold" style={styles.modalTitle}>
              New folder
            </ThemedText>
            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Folder name"
              placeholderTextColor={Colors[colorScheme].icon}
              autoFocus
              onSubmitEditing={handleCreateFolder}
              style={[styles.modalInput, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].icon + '44' }]}
            />
            <View style={styles.colorRow}>
              {FOLDER_COLOR_KEYS.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setNewFolderColor(key)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: FOLDER_COLORS[key] },
                    newFolderColor === key && styles.colorSwatchSelected,
                  ]}
                />
              ))}
            </View>
            {!!newFolderError && <ThemedText style={styles.modalError}>{newFolderError}</ThemedText>}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowNewFolderModal(false)} style={styles.modalCancelButton}>
                <ThemedText style={styles.modalCancelLabel}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleCreateFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                style={[styles.modalCreateButton, { opacity: !newFolderName.trim() || creatingFolder ? 0.5 : 1 }]}>
                {creatingFolder ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={styles.modalCreateLabel} lightColor="#fff" darkColor="#fff">
                    Create
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // zIndex: -1 (not DOM order) keeps this behind the header above it too —
  // absoluteFillObject alone would cover the whole screen including the
  // header/back button, since it's a later sibling in the same stacking context.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
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
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  breadcrumbCrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbLink: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
    maxWidth: 140,
  },
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 14,
  },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '47%',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#8881',
  },
  folderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderText: {
    flex: 1,
    gap: 2,
  },
  folderName: {
    fontSize: 13.5,
  },
  folderMeta: {
    fontSize: 11,
    opacity: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    marginBottom: 14,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  colorSwatchSelected: {
    borderWidth: 2.5,
    borderColor: Brand,
  },
  modalError: {
    color: '#b0392f',
    fontSize: 12.5,
    marginTop: 10,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  modalCancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
  },
  modalCancelLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalCreateButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: Brand,
  },
  modalCreateLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
