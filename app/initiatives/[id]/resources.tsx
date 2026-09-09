import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addResource, addResourceLink, deleteResource, getInitiative, listInitiativeResources, provideResource, unprovideResource } from '@/lib/api/hubService';
import { InitiativeResource } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';

// Real field shapes confirmed against api/server.js's hub_initiative_resources
// table (see types.ts's InitiativeResource) — item/qty/provided_by_name/
// file_display_name/url, not the name/quantity_note/provider_username/
// file_name/link_url guess this screen originally rendered, which is why
// every row used to show the "Item" fallback regardless of what was actually
// pledged. "I can provide this" is further gated to initiative members here
// (viewerIsMember, fetched alongside the resource list) — the server itself
// doesn't require membership on the provide route, so this is a deliberate
// product choice, not a server-enforced rule.
export default function InitiativeResourcesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [resources, setResources] = useState<InitiativeResource[]>([]);
  const [viewerIsMember, setViewerIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // No creator gate on POST /:id/resources itself (see hubService.ts's own
  // addResource note) — gated to viewerIsMember here anyway, matching the
  // existing "I can provide this" precedent in this same file (a deliberate
  // product choice, not something the server enforces).
  const [showAddResource, setShowAddResource] = useState(false);
  const [addKind, setAddKind] = useState<'material' | 'link'>('material');
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addingResource, setAddingResource] = useState(false);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listInitiativeResources(session.hub.tunnelUrl, session.token, id),
      getInitiative(session.hub.tunnelUrl, session.token, id),
    ])
      .then(([nextResources, initiative]) => {
        setResources(nextResources);
        setViewerIsMember(initiative.viewerIsMember);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load resources."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  function toggleProvided(resource: InitiativeResource) {
    if (!session || actingOn) return;
    setActingOn(resource.id);
    const action = resource.provided ? unprovideResource : provideResource;
    action(session.hub.tunnelUrl, session.token, resource.id)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update that."))
      .finally(() => setActingOn(null));
  }

  function submitAddResource() {
    if (!session || !id || addingResource) return;
    if (addKind === 'material' && !newItem.trim()) return;
    if (addKind === 'link' && !newUrl.trim()) return;
    setAddingResource(true);
    const request =
      addKind === 'material'
        ? addResource(session.hub.tunnelUrl, session.token, id, { item: newItem.trim(), qty: newQty.trim() || undefined })
        : addResourceLink(session.hub.tunnelUrl, session.token, id, { url: newUrl.trim(), item: newItem.trim() || undefined });
    request
      .then(() => {
        setNewItem('');
        setNewQty('');
        setNewUrl('');
        setShowAddResource(false);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't add that resource."))
      .finally(() => setAddingResource(false));
  }

  // Server 403s unless the caller is the one who added this resource
  // (InitiativeResource.created_by) — same gate the trash icon below is
  // shown on, for every kind (material/file/link).
  function removeResource(resource: InitiativeResource) {
    if (!session || deletingId) return;
    confirmDestructive(`Remove "${resource.item}"?`, 'Remove', () => {
      setDeletingId(resource.id);
      deleteResource(session.hub.tunnelUrl, session.token, resource.id)
        .then(load)
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't remove that resource."))
        .finally(() => setDeletingId(null));
    });
  }

  const materials = useMemo(() => resources.filter((r) => r.kind === 'material'), [resources]);
  const files = useMemo(() => resources.filter((r) => r.kind === 'file'), [resources]);
  const links = useMemo(() => resources.filter((r) => r.kind === 'link'), [resources]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader
        title="Resources"
        rightIcon={viewerIsMember ? 'plus' : undefined}
        onRightPress={() => setShowAddResource((v) => !v)}
        rightAccessibilityLabel="Add a resource"
      />

      {loading && resources.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView contentContainerStyle={styles.body}>
        {showAddResource && viewerIsMember && (
          <View style={styles.addSection}>
            <View style={styles.addKindRow}>
              <Pressable onPress={() => setAddKind('material')} style={[styles.addKindChip, addKind === 'material' && { backgroundColor: Brand }]}>
                <ThemedText style={styles.addKindLabel} lightColor={addKind === 'material' ? '#fff' : undefined} darkColor={addKind === 'material' ? '#fff' : undefined}>
                  Material
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => setAddKind('link')} style={[styles.addKindChip, addKind === 'link' && { backgroundColor: Brand }]}>
                <ThemedText style={styles.addKindLabel} lightColor={addKind === 'link' ? '#fff' : undefined} darkColor={addKind === 'link' ? '#fff' : undefined}>
                  Link
                </ThemedText>
              </Pressable>
            </View>
            {addKind === 'material' ? (
              <>
                <TextInput
                  autoFocus
                  value={newItem}
                  onChangeText={setNewItem}
                  placeholder="What's needed? (e.g. Folding tables)"
                  placeholderTextColor="#8888"
                  style={[styles.addInput, { color: Colors[colorScheme].text }]}
                />
                <TextInput
                  value={newQty}
                  onChangeText={setNewQty}
                  placeholder="Quantity (optional)"
                  placeholderTextColor="#8888"
                  style={[styles.addInput, { color: Colors[colorScheme].text }]}
                />
              </>
            ) : (
              <>
                <TextInput
                  autoFocus
                  value={newUrl}
                  onChangeText={setNewUrl}
                  placeholder="https://…"
                  placeholderTextColor="#8888"
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[styles.addInput, { color: Colors[colorScheme].text }]}
                />
                <TextInput
                  value={newItem}
                  onChangeText={setNewItem}
                  placeholder="Label (optional)"
                  placeholderTextColor="#8888"
                  style={[styles.addInput, { color: Colors[colorScheme].text }]}
                />
              </>
            )}
            <Pressable
              style={[styles.addButtonWide, (addingResource || (addKind === 'material' ? !newItem.trim() : !newUrl.trim())) && { opacity: 0.5 }]}
              disabled={addingResource || (addKind === 'material' ? !newItem.trim() : !newUrl.trim())}
              onPress={submitAddResource}>
              <ThemedText style={styles.addButtonWideLabel} lightColor="#fff" darkColor="#fff">
                {addingResource ? 'Adding…' : addKind === 'material' ? 'Request material' : 'Add link'}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {materials.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Materials</ThemedText>
            {materials.map((item) => {
              const isMine = !!item.provided_by_user_id && item.provided_by_user_id === session.userId;
              const busy = actingOn === item.id;
              const canRemove = item.created_by === session.userId;
              return (
                <View key={item.id} style={styles.materialRow}>
                  <View style={styles.materialText}>
                    <ThemedText type="defaultSemiBold" style={styles.materialName}>
                      {item.item}
                    </ThemedText>
                    {!!item.qty && <ThemedText style={styles.rowMeta}>{item.qty}</ThemedText>}
                  </View>
                  {item.provided ? (
                    isMine ? (
                      <Pressable style={[styles.outlineButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => toggleProvided(item)}>
                        <ThemedText style={styles.outlineButtonLabel}>Not me after all</ThemedText>
                      </Pressable>
                    ) : (
                      <ThemedText style={styles.rowMeta}>Provided by {item.provided_by_name ?? 'a neighbor'}</ThemedText>
                    )
                  ) : viewerIsMember ? (
                    <Pressable style={[styles.provideButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => toggleProvided(item)}>
                      <ThemedText style={styles.provideButtonLabel} lightColor="#fff" darkColor="#fff">
                        I can provide this
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <ThemedText style={styles.rowMeta}>Join to help provide this</ThemedText>
                  )}
                  {canRemove && (
                    <Pressable hitSlop={8} disabled={deletingId === item.id} onPress={() => removeResource(item)}>
                      <IconSymbol name="trash.fill" size={15} color={Colors[colorScheme].icon} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {files.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Attached files</ThemedText>
            {files.map((item) => (
              <View key={item.id} style={styles.fileRow}>
                <Pressable
                  style={styles.fileRowMain}
                  disabled={!item.file_id}
                  onPress={() => item.file_id && router.push(`/files/${encodeURIComponent(item.file_id)}` as unknown as Href)}>
                  <View style={styles.fileTile}>
                    <IconSymbol name="doc.fill" size={16} color={Colors[colorScheme].icon} />
                  </View>
                  <View style={styles.materialText}>
                    <ThemedText type="defaultSemiBold" numberOfLines={1}>
                      {item.file_display_name ?? item.item}
                    </ThemedText>
                    {!!item.file_size_bytes && <ThemedText style={styles.rowMeta}>{formatBytes(item.file_size_bytes)}</ThemedText>}
                  </View>
                  {!!item.file_id && <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />}
                </Pressable>
                {item.created_by === session.userId && (
                  <Pressable hitSlop={8} disabled={deletingId === item.id} onPress={() => removeResource(item)}>
                    <IconSymbol name="trash.fill" size={15} color={Colors[colorScheme].icon} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {links.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>External links</ThemedText>
            {links.map((item) => (
              <View key={item.id} style={styles.linkRow}>
                <Pressable style={styles.fileRowMain} onPress={() => item.url && Linking.openURL(item.url)}>
                  <View style={styles.fileTile}>
                    <IconSymbol name="link" size={16} color={Colors[colorScheme].icon} />
                  </View>
                  <View style={styles.materialText}>
                    <ThemedText type="defaultSemiBold" numberOfLines={1}>
                      {item.item}
                    </ThemedText>
                    <ThemedText style={styles.rowMeta} numberOfLines={1}>
                      {item.url}
                    </ThemedText>
                  </View>
                  <IconSymbol name="arrow.up.right.square" size={16} color={Colors[colorScheme].icon} />
                </Pressable>
                {item.created_by === session.userId && (
                  <Pressable hitSlop={8} disabled={deletingId === item.id} onPress={() => removeResource(item)}>
                    <IconSymbol name="trash.fill" size={15} color={Colors[colorScheme].icon} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {!loading && resources.length === 0 && <ThemedText style={styles.empty}>Nothing requested yet.</ThemedText>}

        {resources.length > 0 && (
          <View style={styles.footerNote}>
            <IconSymbol name="shield.fill" size={14} color={Colors[colorScheme].icon} />
            <ThemedText style={styles.footerNoteText}>Pledges are visible to the initiative team</ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
    paddingBottom: 40,
  },
  addSection: {
    gap: 8,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  addKindRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  addKindChip: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addKindLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  addInput: {
    fontSize: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8882',
  },
  addButtonWide: {
    height: 40,
    borderRadius: 10,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  addButtonWideLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  rowMeta: {
    fontSize: 11.5,
    opacity: 0.55,
  },
  materialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  materialText: {
    flex: 1,
    gap: 2,
  },
  materialName: {
    fontSize: 14.5,
  },
  provideButton: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  provideButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  outlineButton: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  fileRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileTile: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#8881',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
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
    marginTop: 8,
  },
  footerNoteText: {
    fontSize: 12,
    opacity: 0.55,
  },
});
