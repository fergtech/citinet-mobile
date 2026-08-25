import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { HubAvatar } from '@/components/hub-avatar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/theme';
import { createConversation, getMember } from '@/lib/api/hubService';
import { HubMember } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

// The other-member equivalent of app/(tabs)/profile.tsx — a pushed screen
// (back-chevron header, not a tab), reached by tapping any avatar/username
// anywhere in the app (see lib/ui/navigate-to-profile.ts). No Settings
// section (that's account-only) and no spaces list (not tackling Spaces
// yet) — just identity and a way to message them.
export default function MemberProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { session } = useSession();

  const [member, setMember] = useState<HubMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setError(null);
    getMember(session.hub.tunnelUrl, session.token, userId)
      .then(setMember)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session, userId]);

  async function handleMessage() {
    if (!session || !member) return;
    setMessaging(true);
    try {
      const convo = await createConversation(session.hub.tunnelUrl, session.token, member.user_id);
      router.push({
        pathname: '/conversation/[id]',
        params: { id: convo.conversation_id, title: member.display_name || member.username, peerId: member.user_id },
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
      <ScreenHeader title={member?.display_name || member?.username || 'Profile'} />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {member && (
        <View style={styles.body}>
          <HubAvatar userId={member.user_id} displayName={member.display_name || member.username} tunnelUrl={session.hub.tunnelUrl} size={88} />
          <View style={styles.nameRow}>
            <ThemedText type="title" style={styles.name}>
              {member.display_name || member.username}
            </ThemedText>
            {member.is_admin && (
              <View style={styles.adminBadge}>
                <ThemedText style={styles.adminBadgeLabel}>Admin</ThemedText>
              </View>
            )}
          </View>
          <ThemedText style={styles.username}>@{member.username}</ThemedText>

          {member.bio && <ThemedText style={styles.bio}>{member.bio}</ThemedText>}
          {member.location && (
            <View style={styles.locationRow}>
              <IconSymbol name="mappin.and.ellipse" size={14} color={Brand} />
              <ThemedText style={styles.location}>{member.location}</ThemedText>
            </View>
          )}

          <Pressable
            onPress={handleMessage}
            disabled={messaging}
            style={[styles.messageButton, { opacity: messaging ? 0.6 : 1 }]}>
            <IconSymbol name="paperplane.fill" size={16} color="#fff" />
            <ThemedText style={styles.messageButtonLabel} lightColor="#fff" darkColor="#fff">
              Message
            </ThemedText>
          </Pressable>
        </View>
      )}
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
    marginTop: 12,
  },
  body: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  name: {
    fontSize: 21,
  },
  adminBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8888',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  adminBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.7,
  },
  username: {
    opacity: 0.6,
    marginTop: 2,
  },
  bio: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 16,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  location: {
    fontSize: 13,
    opacity: 0.6,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 24,
  },
  messageButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
