import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reportContent } from '@/lib/api/hubService';
import { ReportReason, ReportTargetType } from '@/lib/api/types';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'other', label: 'Something else' },
];

// Reason picker + optional free-text details, backed by POST /api/reports.
// Shared across post/reply/message/listing/member report entry points —
// callers just supply what's being reported.
export function ReportSheet({
  visible,
  onClose,
  tunnelUrl,
  token,
  targetType,
  targetId,
}: {
  visible: boolean;
  onClose: () => void;
  tunnelUrl: string;
  token: string;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    onClose();
    // Reset after the close animation finishes, not before — resetting
    // immediately flashes the sheet back to step one while it's still
    // sliding away.
    setTimeout(() => {
      setReason(null);
      setDetails('');
      setSubmitted(false);
      setError(null);
    }, 300);
  }

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportContent(tunnelUrl, token, targetType, targetId, reason, details.trim() || undefined);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: Colors[colorScheme].background }]}>
          {submitted ? (
            <View style={styles.confirmWrap}>
              <IconSymbol name="checkmark.circle.fill" size={32} color={Brand} />
              <ThemedText style={styles.confirmText}>Report submitted. A moderator will review it.</ThemedText>
              <Pressable onPress={handleClose} style={styles.doneButton}>
                <ThemedText style={{ color: Brand, fontWeight: '600' }}>Done</ThemedText>
              </Pressable>
            </View>
          ) : (
            <>
              <ThemedText type="defaultSemiBold" style={styles.title}>
                Report
              </ThemedText>
              {REASONS.map((r) => (
                <Pressable key={r.value} onPress={() => setReason(r.value)} style={styles.reasonRow}>
                  <IconSymbol
                    name={reason === r.value ? 'checkmark.circle.fill' : 'circle'}
                    size={18}
                    color={reason === r.value ? Brand : Colors[colorScheme].icon}
                  />
                  <ThemedText style={styles.reasonLabel}>{r.label}</ThemedText>
                </Pressable>
              ))}
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Add details (optional)"
                placeholderTextColor={Colors[colorScheme].icon}
                multiline
                style={[styles.input, { color: Colors[colorScheme].text }]}
              />
              {error && <ThemedText style={styles.error}>{error}</ThemedText>}
              <View style={styles.buttonRow}>
                <Pressable onPress={handleClose} style={styles.cancelButton}>
                  <ThemedText>Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!reason || submitting}
                  style={[styles.submitButton, { backgroundColor: Brand, opacity: !reason || submitting ? 0.5 : 1 }]}>
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText lightColor="#fff" darkColor="#fff" style={styles.submitLabel}>
                      Submit report
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  title: {
    fontSize: 17,
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  reasonLabel: {
    fontSize: 15,
  },
  input: {
    backgroundColor: '#8881',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
    marginTop: 10,
  },
  error: {
    color: '#b0392f',
    fontSize: 13,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#8881',
  },
  submitButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 999,
  },
  submitLabel: {
    fontWeight: '600',
  },
  confirmWrap: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  confirmText: {
    textAlign: 'center',
    fontSize: 15,
  },
  doneButton: {
    marginTop: 8,
    paddingVertical: 8,
  },
});
