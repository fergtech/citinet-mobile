import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listConversations } from '@/lib/api/hubService';
import type { ConversationMember } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';
import { goToProfile } from '@/lib/ui/navigate-to-profile';

export default function GroupMembersScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    listConversations(session.hub.tunnelUrl, session.token)
      .then((conversations) => {
        const conversation = conversations.find((item) => item.conversation_id === id);
        setMembers(conversation?.kind === 'group' ? conversation.members : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load members.'))
      .finally(() => setLoading(false));
  }, [id, session]);

  if (!session) return null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
          <IconSymbol name="xmark" size={22} color={Colors[colorScheme].text} />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle} numberOfLines={1}>
          {title || 'Group members'}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={members}
        keyExtractor={(member) => member.user_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => {
              router.back();
              goToProfile(item.user_id, session.userId);
            }}
            accessibilityRole="button">
            <HubAvatar
              userId={item.user_id}
              displayName={item.username}
              tunnelUrl={session.hub.tunnelUrl}
              size={42}
            />
            <ThemedText type="defaultSemiBold" style={styles.username}>
              @{item.username}
            </ThemedText>
            <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />
          </Pressable>
        )}
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No members found.</ThemedText> : null}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    marginHorizontal: 16,
  },
  headerSpacer: {
    width: 22,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  username: {
    flex: 1,
    fontSize: 15.5,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13,
  },
});