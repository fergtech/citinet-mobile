import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AuthBackground } from '@/components/auth-background';
import { BrandGradient } from '@/components/brand-gradient';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

// Mobile equivalent of citinet web's PendingApprovalScreen — shown instead of
// the main app for an account that registered (or logged in) but isn't
// approved yet. No member_vote vs admin-approval distinction here (the web
// version reads that off currentHub.joinApprovalMode, which mobile has no
// equivalent fetch for) — the copy stays generic across both modes.
export default function PendingApprovalScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { pendingAccount, checkPendingStatus, cancelPending } = useSession();

  const [checking, setChecking] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);

  async function handleCheckAgain() {
    setChecking(true);
    setStillWaiting(false);
    const approved = await checkPendingStatus().catch(() => false);
    setChecking(false);
    if (!approved) setStillWaiting(true);
  }

  if (!pendingAccount) return null;
  const rejected = pendingAccount.accountStatus === 'rejected';

  return (
    <ThemedView style={[styles.container, styles.transparentBg]}>
      <AuthBackground />
      <View style={styles.centerWrap}>
        <View style={[styles.card, { backgroundColor: colorScheme === 'dark' ? 'rgba(21,23,24,0.82)' : 'rgba(255,255,255,0.88)' }]}>
          <View style={[styles.iconCircle, rejected ? styles.iconCircleRejected : styles.iconCirclePending]}>
            <IconSymbol name={rejected ? 'exclamationmark.octagon.fill' : 'clock.fill'} size={30} color="#fff" />
          </View>

          <ThemedText type="title" style={[styles.heading, styles.centerText]}>
            {rejected ? 'Access request declined' : `Waiting on ${pendingAccount.hub.name}`}
          </ThemedText>
          <ThemedText style={[styles.body, styles.centerText]}>
            {rejected
              ? "The hub admin declined this account's access request. If you think this is a mistake, reach out to them directly."
              : "Your account has been created but needs the hub admin's approval before you can get in. This usually doesn't take long."}
          </ThemedText>

          {!rejected && (
            <Pressable onPress={handleCheckAgain} disabled={checking} style={[styles.checkButton, { opacity: checking ? 0.6 : 1 }]}>
              <BrandGradient style={styles.checkButtonFill}>
                {checking ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.checkButtonLabel} lightColor="#fff" darkColor="#fff">
                    Check again
                  </ThemedText>
                )}
              </BrandGradient>
            </Pressable>
          )}
          {stillWaiting && <ThemedText style={[styles.stillWaiting, styles.centerText]}>Still waiting on approval.</ThemedText>}

          <Pressable onPress={cancelPending} style={styles.backButton}>
            <ThemedText style={styles.backButtonLabel}>Back to onboarding</ThemedText>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  transparentBg: {
    backgroundColor: 'transparent',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconCirclePending: {
    backgroundColor: '#2563eb',
  },
  iconCircleRejected: {
    backgroundColor: '#b0392f',
  },
  centerText: {
    textAlign: 'center',
  },
  heading: {
    marginBottom: 8,
  },
  body: {
    opacity: 0.7,
    lineHeight: 20,
    marginBottom: 20,
  },
  checkButton: {
    height: 48,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  checkButtonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  stillWaiting: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 10,
  },
  backButton: {
    marginTop: 16,
    paddingVertical: 6,
  },
  backButtonLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    opacity: 0.6,
  },
});
