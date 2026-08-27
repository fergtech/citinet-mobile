import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { BroadcastAudience, useBroadcast } from '@/lib/comms/broadcast-context';
import { useSession } from '@/lib/session/session-context';

const AUDIENCE_OPTIONS: { value: BroadcastAudience; label: string }[] = [
  { value: 'hub', label: 'Whole hub' },
  { value: 'space', label: 'A space' },
  { value: 'neighbors', label: 'Neighbors' },
];

// Host-only — there's no "incoming broadcast" counterpart to app/call/
// setup.tsx's answer flow. Viewers reach the live screen directly by
// tapping a LiveCard on the Messages screen (see BroadcastProvider's
// joinAsViewer), never through here.
export default function BroadcastSetupScreen() {
  const { session } = useSession();
  const { broadcast, startBroadcast, toggleMic, toggleCam } = useBroadcast();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<BroadcastAudience>('hub');

  function handleGoLive() {
    startBroadcast({ title: title.trim() || 'Live broadcast', audience });
    router.back();
  }

  function handleClose() {
    router.back();
  }

  const hubHost = session?.hub.tunnelUrl.replace(/^https?:\/\//, '') ?? '';

  return (
    <View style={styles.flex}>
      <LinearGradient colors={['#DC2B2B', '#07060F']} style={styles.glow} pointerEvents="none" />

      <View style={styles.header}>
        <Pressable onPress={handleClose} style={styles.closeButton} accessibilityLabel="Close" accessibilityRole="button">
          <IconSymbol name="xmark" size={16} color="#fff" />
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle} lightColor="#fff" darkColor="#fff">
          Broadcast
        </ThemedText>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What are you going live about?"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.titleInput}
          multiline
          maxLength={140}
        />

        <ThemedText style={styles.sectionLabel} lightColor="rgba(255,255,255,0.6)" darkColor="rgba(255,255,255,0.6)">
          Who can watch
        </ThemedText>
        <View style={styles.audienceRow}>
          {AUDIENCE_OPTIONS.map((option) => {
            const active = audience === option.value;
            return (
              <Pressable key={option.value} onPress={() => setAudience(option.value)} style={[styles.audiencePill, active && styles.audiencePillActive]}>
                <ThemedText style={[styles.audiencePillLabel, active && styles.audiencePillLabelActive]} lightColor="#fff" darkColor="#fff">
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.togglesRow}>
          <ToggleButton icon={broadcast.micOn ? 'mic.fill' : 'mic.slash.fill'} active={!broadcast.micOn} label={broadcast.micOn ? 'Mic on' : 'Muted'} onPress={toggleMic} />
          <ToggleButton icon={broadcast.camOn ? 'video.fill' : 'video.slash.fill'} active={!broadcast.camOn} label={broadcast.camOn ? 'Camera on' : 'Camera off'} onPress={toggleCam} />
          {/* Same as call/setup.tsx's own Flip — no live track to flip
              pre-connect, real once components/comms/broadcast-overlay.tsx
              takes over. */}
          <ToggleButton icon="arrow.triangle.2.circlepath.camera.fill" active={false} label="Flip" onPress={() => {}} />
        </View>
      </ScrollView>

      <Pressable onPress={handleGoLive} style={styles.goLiveButton}>
        <IconSymbol name="dot.radiowaves.left.and.right" size={18} color="#fff" />
        <ThemedText type="defaultSemiBold" style={styles.goLiveLabel} lightColor="#fff" darkColor="#fff">
          Go live
        </ThemedText>
      </Pressable>
      <ThemedText style={styles.footnote} lightColor="rgba(255,255,255,0.5)" darkColor="rgba(255,255,255,0.5)">
        Stays inside {hubHost} · nothing leaves your hub
      </ThemedText>
    </View>
  );
}

function ToggleButton({ icon, active, label, onPress }: { icon: Parameters<typeof IconSymbol>[0]['name']; active: boolean; label: string; onPress: () => void }) {
  return (
    <View style={styles.toggleItem}>
      <Pressable onPress={onPress} style={[styles.toggleCircle, active && styles.toggleCircleActive]}>
        <IconSymbol name={icon} size={22} color={active ? '#07060F' : '#fff'} />
      </Pressable>
      <ThemedText style={styles.toggleLabel} lightColor="rgba(255,255,255,0.8)" darkColor="rgba(255,255,255,0.8)" numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#07060F',
    paddingHorizontal: 20,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    opacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
  },
  body: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 16,
  },
  titleInput: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    minHeight: 56,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  audienceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  audiencePill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  audiencePillActive: {
    backgroundColor: '#DC2B2B',
  },
  audiencePillLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    opacity: 0.75,
  },
  audiencePillLabelActive: {
    opacity: 1,
  },
  togglesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
  },
  toggleItem: {
    width: 66,
    alignItems: 'center',
    gap: 6,
  },
  toggleCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCircleActive: {
    backgroundColor: '#fff',
  },
  toggleLabel: {
    fontSize: 11,
  },
  goLiveButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DC2B2B',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  goLiveLabel: {
    fontSize: 16,
  },
  footnote: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    marginBottom: 24,
  },
});
