import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInitiative, listInitiativeResources, provideResource, unprovideResource } from '@/lib/api/hubService';
import { InitiativeResource } from '@/lib/api/types';
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

  const materials = useMemo(() => resources.filter((r) => r.kind === 'material'), [resources]);
  const files = useMemo(() => resources.filter((r) => r.kind === 'file'), [resources]);
  const links = useMemo(() => resources.filter((r) => r.kind === 'link'), [resources]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Resources" />

      {loading && resources.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView contentContainerStyle={styles.body}>
        {materials.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Materials</ThemedText>
            {materials.map((item) => {
              const isMine = !!item.provided_by_user_id && item.provided_by_user_id === session.userId;
              const busy = actingOn === item.id;
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
                </View>
              );
            })}
          </View>
        )}

        {files.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Attached files</ThemedText>
            {files.map((item) => (
              <Pressable
                key={item.id}
                style={styles.fileRow}
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
            ))}
          </View>
        )}

        {links.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>External links</ThemedText>
            {links.map((item) => (
              <Pressable key={item.id} style={styles.linkRow} onPress={() => item.url && Linking.openURL(item.url)}>
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
