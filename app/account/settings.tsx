import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { changePassword, deleteAccount, getMember, updateProfile } from '@/lib/api/hubService';
import { confirmDestructive } from '@/lib/ui/confirm';
import { useSession } from '@/lib/session/session-context';

// Profile field editing + password change + account deletion, all real
// endpoints (PATCH /api/auth/profile, POST /api/auth/change-password,
// DELETE /api/auth/account) mirroring citinet web's AccountScreen — trimmed
// to what mobile actually needs (no avatar/banner upload, no tags editor,
// no appearance/background customization; this app's styling is fixed
// StyleSheet + light/dark, not user-customizable per [[project scope]]).
export default function AccountSettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session, signOut } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    getMember(session.hub.tunnelUrl, session.token, session.userId)
      .then((member) => {
        setDisplayName(member.display_name ?? session.displayName);
        setHeadline(member.profile_headline ?? '');
        setBio(member.bio ?? '');
        setWebsite(member.website ?? '');
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  async function handleSaveProfile() {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateProfile(session.hub.tunnelUrl, session.token, {
        displayName: displayName.trim(),
        profileHeadline: headline.trim(),
        bio: bio.trim(),
        website: website.trim(),
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!session || !currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwSaving(true);
    setPwError(null);
    setPwSaved(false);
    try {
      await changePassword(session.hub.tunnelUrl, session.token, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSaved(true);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  }

  function handleDeleteAccount() {
    if (!session || !deletePassword) return;
    confirmDestructive('Permanently delete your account? This cannot be undone.', 'Delete', async () => {
      setDeleting(true);
      setDeleteError(null);
      try {
        await deleteAccount(session.hub.tunnelUrl, session.token, deletePassword);
        // No manual navigation needed — signOut() flips session status to
        // 'signedOut', and app/_layout.tsx's Stack.Protected guard reactively
        // switches to the (auth) group, same as the ordinary sign-out flow.
        await signOut();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete account.');
        setDeleting(false);
      }
    });
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Account" />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {loadError && <ThemedText style={styles.error}>{loadError}</ThemedText>}

      {!loading && (
        <ScrollView
          contentContainerStyle={styles.body}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic">
          <ThemedText style={styles.sectionLabel}>Profile</ThemedText>
          <View style={styles.section}>
            <ThemedText style={styles.fieldLabel}>Display name</ThemedText>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              style={[styles.input, { color: Colors[colorScheme].text }]}
              placeholderTextColor={Colors[colorScheme].icon}
            />
            <ThemedText style={styles.fieldLabel}>Headline</ThemedText>
            <TextInput
              value={headline}
              onChangeText={setHeadline}
              placeholder="A short line about you"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />
            <ThemedText style={styles.fieldLabel}>Bio</ThemedText>
            <TextInput
              value={bio}
              onChangeText={setBio}
              multiline
              placeholder="Tell your neighbors about yourself"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, styles.textArea, { color: Colors[colorScheme].text }]}
            />
            <ThemedText style={styles.fieldLabel}>Website</ThemedText>
            <TextInput
              value={website}
              onChangeText={setWebsite}
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />

            {saveError && <ThemedText style={styles.error}>{saveError}</ThemedText>}
            <Pressable onPress={handleSaveProfile} disabled={saving} style={[styles.saveButton, { opacity: saving ? 0.6 : 1 }]}>
              <BrandGradient style={styles.saveButtonFill}>
                <ThemedText style={styles.saveButtonLabel} lightColor="#fff" darkColor="#fff">
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
                </ThemedText>
              </BrandGradient>
            </Pressable>
          </View>

          <ThemedText style={styles.sectionLabel}>Password</ThemedText>
          <View style={styles.section}>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              secureTextEntry
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              secureTextEntry
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              secureTextEntry
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.input, { color: Colors[colorScheme].text }]}
            />
            {pwError && <ThemedText style={styles.error}>{pwError}</ThemedText>}
            <Pressable
              onPress={handleChangePassword}
              disabled={pwSaving || !currentPassword || !newPassword}
              style={[styles.outlineButton, { borderColor: Colors[colorScheme].icon, opacity: pwSaving || !currentPassword || !newPassword ? 0.5 : 1 }]}>
              <ThemedText style={styles.outlineButtonLabel}>
                {pwSaving ? 'Changing…' : pwSaved ? 'Password changed' : 'Change password'}
              </ThemedText>
            </Pressable>
          </View>

          <ThemedText style={[styles.sectionLabel, styles.dangerLabel]}>Danger zone</ThemedText>
          <View style={styles.section}>
            {!showDelete ? (
              <Pressable onPress={() => setShowDelete(true)} style={styles.dangerButton}>
                <ThemedText style={styles.dangerButtonLabel}>Delete account</ThemedText>
              </Pressable>
            ) : (
              <>
                <ThemedText style={styles.rowMeta}>Enter your password to confirm — this permanently deletes your account.</ThemedText>
                <TextInput
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  placeholder="Password"
                  secureTextEntry
                  placeholderTextColor={Colors[colorScheme].icon}
                  style={[styles.input, { color: Colors[colorScheme].text, backgroundColor: '#b0392f1a' }]}
                />
                {deleteError && <ThemedText style={styles.error}>{deleteError}</ThemedText>}
                <Pressable
                  onPress={handleDeleteAccount}
                  disabled={deleting || !deletePassword}
                  style={[styles.dangerButton, { opacity: deleting || !deletePassword ? 0.5 : 1 }]}>
                  <ThemedText style={styles.dangerButtonLabel}>
                    {deleting ? 'Deleting…' : 'Permanently delete my account'}
                  </ThemedText>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
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
    fontSize: 13,
    marginBottom: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 20,
  },
  dangerLabel: {
    color: '#b0392f',
    opacity: 0.9,
  },
  section: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12.5,
    opacity: 0.6,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 8,
  },
  saveButtonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  outlineButton: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  outlineButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 12.5,
    lineHeight: 17,
  },
  dangerButton: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b0392f',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dangerButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#b0392f',
  },
});
