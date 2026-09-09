import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addRole, deleteRole, getInitiative, listInitiativeRoles, stepDownFromRole, volunteerForRole } from '@/lib/api/hubService';
import { Initiative, InitiativeRole } from '@/lib/api/types';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useSession } from '@/lib/session/session-context';

// Unlike Team/Tasks, there's no roles data embedded in GET /api/initiatives/:id
// (only a bare `open_roles_count`) — this has to hit the separate /roles
// endpoint, whose response shape hasn't been confirmed against a live hub.
// listInitiativeRoles already degrades to an empty list rather than throwing
// if the envelope key doesn't match, so a shape mismatch shows "no roles"
// here instead of crashing — but that also means an empty list could mean
// either "genuinely no roles" or "wrong field name," and there's no way to
// tell without seeing a real response.
export default function InitiativeRolesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [roles, setRoles] = useState<InitiativeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleSkill, setNewRoleSkill] = useState('');
  const [addingRole, setAddingRole] = useState(false);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      listInitiativeRoles(session.hub.tunnelUrl, session.token, id),
      getInitiative(session.hub.tunnelUrl, session.token, id),
    ])
      .then(([nextRoles, nextInitiative]) => {
        setRoles(nextRoles);
        setInitiative(nextInitiative);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load open roles."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  function handleVolunteer(roleId: string) {
    if (!session || actingOn) return;
    setActingOn(roleId);
    volunteerForRole(session.hub.tunnelUrl, session.token, roleId)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't claim that role."))
      .finally(() => setActingOn(null));
  }

  function handleStepDown(roleId: string) {
    if (!session || actingOn) return;
    setActingOn(roleId);
    stepDownFromRole(session.hub.tunnelUrl, session.token, roleId)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't step down from that role."))
      .finally(() => setActingOn(null));
  }

  // Creator-only server-side (assertInitiativeCreator on POST /:id/roles) —
  // gated the same way as the "+" that opens this composer.
  function submitAddRole() {
    if (!session || !id || !newRoleName.trim() || addingRole) return;
    setAddingRole(true);
    addRole(session.hub.tunnelUrl, session.token, id, { role: newRoleName.trim(), skill: newRoleSkill.trim() || undefined })
      .then(() => {
        setNewRoleName('');
        setNewRoleSkill('');
        setShowAddRole(false);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't add that role."))
      .finally(() => setAddingRole(false));
  }

  // Server 403s unless the caller is the one who opened this role
  // (role.created_by) — same gate the trash icon below is shown on.
  function handleRemoveRole(role: InitiativeRole) {
    if (!session || deletingId) return;
    confirmDestructive(`Remove the "${role.role}" role?`, 'Remove', () => {
      setDeletingId(role.id);
      deleteRole(session.hub.tunnelUrl, session.token, role.id)
        .then(load)
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't remove that role."))
        .finally(() => setDeletingId(null));
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader
        title="Open roles"
        rightIcon={initiative?.viewerIsCreator ? 'plus' : undefined}
        onRightPress={() => setShowAddRole((v) => !v)}
        rightAccessibilityLabel="Add a role"
      />

      {loading && roles.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={roles}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <ThemedText style={styles.intro}>
              Claim a role and the organizer sees your name on the team. You can step down any time.
            </ThemedText>
            {showAddRole && initiative?.viewerIsCreator && (
              <View style={styles.addRoleBlock}>
                <TextInput
                  autoFocus
                  value={newRoleName}
                  onChangeText={setNewRoleName}
                  placeholder="Role (e.g. Setup crew)"
                  placeholderTextColor="#8888"
                  style={[styles.addRoleInput, { color: Colors[colorScheme].text }]}
                />
                <TextInput
                  value={newRoleSkill}
                  onChangeText={setNewRoleSkill}
                  onSubmitEditing={submitAddRole}
                  placeholder="Skill needed (optional)"
                  placeholderTextColor="#8888"
                  style={[styles.addRoleInput, { color: Colors[colorScheme].text }]}
                />
                <Pressable
                  style={[styles.addRoleButton, (addingRole || !newRoleName.trim()) && { opacity: 0.5 }]}
                  disabled={addingRole || !newRoleName.trim()}
                  onPress={submitAddRole}>
                  <ThemedText style={styles.addRoleButtonLabel} lightColor="#fff" darkColor="#fff">
                    {addingRole ? 'Adding…' : 'Add role'}
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isMine = !!session && item.filled_by_user_id === session.userId;
          const busy = actingOn === item.id;
          const canRemove = item.created_by === session.userId;
          return (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.rowHeaderStatus}>
                  <View style={[styles.statusDot, { backgroundColor: item.filled ? Colors[colorScheme].icon : '#059669' }]} />
                  <ThemedText style={[styles.statusLabel, { color: item.filled ? Colors[colorScheme].icon : '#059669' }]}>
                    {item.filled ? 'FILLED' : 'OPEN'}
                  </ThemedText>
                </View>
                {canRemove && (
                  <Pressable hitSlop={8} style={styles.removeRoleButton} disabled={deletingId === item.id} onPress={() => handleRemoveRole(item)}>
                    <IconSymbol name="trash.fill" size={14} color={Colors[colorScheme].icon} />
                  </Pressable>
                )}
              </View>
              <ThemedText type="defaultSemiBold" style={styles.roleName}>
                {item.role}
              </ThemedText>
              {!!item.skill && <ThemedText style={styles.skills}>{item.skill}</ThemedText>}

              {!item.filled && (
                <Pressable style={[styles.volunteerButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => handleVolunteer(item.id)}>
                  <IconSymbol name="hand.raised.fill" size={14} color="#fff" />
                  <ThemedText style={styles.volunteerLabel} lightColor="#fff" darkColor="#fff">
                    Volunteer
                  </ThemedText>
                </Pressable>
              )}
              {item.filled && isMine && (
                <Pressable style={[styles.stepDownButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => handleStepDown(item.id)}>
                  <ThemedText style={styles.stepDownLabel}>You claimed this — step down</ThemedText>
                </Pressable>
              )}
              {item.filled && !isMine && <ThemedText style={styles.holder}>{item.filled_by_name ?? 'Filled'}</ThemedText>}
            </View>
          );
        }}
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No open roles right now.</ThemedText> : null}
        ListFooterComponent={
          roles.length > 0 ? (
            <ThemedText style={styles.footerNote}>Volunteering also joins you to the initiative</ThemedText>
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
  spinner: {
    marginTop: 40,
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
  intro: {
    fontSize: 13,
    opacity: 0.6,
    lineHeight: 18,
    marginBottom: 10,
  },
  addRoleBlock: {
    gap: 8,
    marginBottom: 14,
  },
  addRoleInput: {
    fontSize: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#8882',
  },
  addRoleButton: {
    height: 38,
    borderRadius: 10,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  addRoleButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    paddingVertical: 14,
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowHeaderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeRoleButton: {
    padding: 2,
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
    letterSpacing: 0.4,
  },
  roleName: {
    fontSize: 15,
  },
  skills: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.7,
  },
  volunteerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 38,
    borderRadius: 999,
    backgroundColor: Brand,
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  volunteerLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepDownButton: {
    height: 38,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  stepDownLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  holder: {
    fontSize: 12.5,
    opacity: 0.6,
    marginTop: 4,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
  footerNote: {
    fontSize: 12,
    opacity: 0.55,
    textAlign: 'center',
    marginTop: 20,
  },
});
