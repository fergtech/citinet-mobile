import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { listFiles } from '@/lib/api/hubService';
import { FileKind, HubFile } from '@/lib/api/types';
import { FILE_KIND_META, fileKind, formatBytes } from '@/lib/files/kind';
import { useSession } from '@/lib/session/session-context';

const KIND_ORDER: FileKind[] = ['image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'zip', 'other'];

export default function StorageScreen() {
  const { session } = useSession();

  const [files, setFiles] = useState<HubFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    listFiles(session.hub.tunnelUrl, session.token)
      .then((f) => !cancelled && setFiles(f))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load storage stats."));
    return () => {
      cancelled = true;
    };
  }, [session]);

  const stats = useMemo(() => {
    if (!files || !session) return null;
    const totalBytes = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    const yours = files.filter((f) => f.owner_id === session.userId);
    const publicLinks = files.filter((f) => f.web_public);

    const byKind = new Map<FileKind, { count: number; bytes: number }>();
    for (const f of files) {
      const kind = fileKind(f.file_name, f.mime_type);
      const entry = byKind.get(kind) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += f.size_bytes || 0;
      byKind.set(kind, entry);
    }
    const breakdown = KIND_ORDER.map((kind) => ({ kind, ...(byKind.get(kind) ?? { count: 0, bytes: 0 }) }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      totalBytes,
      totalCount: files.length,
      yourCount: yours.length,
      publicCount: publicLinks.length,
      breakdown,
      maxCount: breakdown.length ? breakdown[0].count : 1,
    };
  }, [files, session]);

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Storage" />

      {!stats && !error && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {stats && (
        <View style={styles.body}>
          <View style={styles.totalBlock}>
            <ThemedText type="title" style={styles.totalValue}>
              {formatBytes(stats.totalBytes)}
            </ThemedText>
            <ThemedText style={styles.totalLabel}>total, across files visible to you on this hub</ThemedText>
          </View>

          <View style={styles.tilesRow}>
            <View style={styles.tile}>
              <ThemedText type="defaultSemiBold" style={styles.tileValue}>
                {stats.totalCount}
              </ThemedText>
              <ThemedText style={styles.tileLabel}>Files stored</ThemedText>
            </View>
            <View style={styles.tileDivider} />
            <View style={styles.tile}>
              <ThemedText type="defaultSemiBold" style={styles.tileValue}>
                {stats.yourCount}
              </ThemedText>
              <ThemedText style={styles.tileLabel}>Your uploads</ThemedText>
            </View>
            <View style={styles.tileDivider} />
            <View style={styles.tile}>
              <ThemedText type="defaultSemiBold" style={styles.tileValue}>
                {stats.publicCount}
              </ThemedText>
              <ThemedText style={styles.tileLabel}>Public links</ThemedText>
            </View>
          </View>

          <ThemedText style={styles.sectionLabel}>By file type</ThemedText>
          <View style={styles.breakdown}>
            {stats.breakdown.map(({ kind, count, bytes }) => {
              const meta = FILE_KIND_META[kind];
              return (
                <View key={kind} style={styles.breakdownRow}>
                  <View style={[styles.breakdownIcon, { backgroundColor: meta.color }]}>
                    <IconSymbol name={meta.icon} size={14} color="#fff" />
                  </View>
                  <View style={styles.breakdownText}>
                    <View style={styles.breakdownHeader}>
                      <ThemedText style={styles.breakdownLabel}>{meta.label}</ThemedText>
                      <ThemedText style={styles.breakdownMeta}>
                        {count} · {formatBytes(bytes)}
                      </ThemedText>
                    </View>
                    <View style={styles.breakdownTrack}>
                      <View style={[styles.breakdownFill, { width: `${(count / stats.maxCount) * 100}%`, backgroundColor: meta.color }]} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
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
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  totalBlock: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  totalValue: {
    fontSize: 32,
  },
  totalLabel: {
    fontSize: 12.5,
    opacity: 0.6,
    marginTop: 4,
    textAlign: 'center',
  },
  tilesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#8881',
    marginBottom: 8,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  tileDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#8884',
  },
  tileValue: {
    fontSize: 18,
  },
  tileLabel: {
    fontSize: 10.5,
    opacity: 0.6,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 8,
  },
  breakdown: {
    gap: 14,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  breakdownIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownText: {
    flex: 1,
    gap: 6,
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  breakdownMeta: {
    fontSize: 12,
    opacity: 0.6,
  },
  breakdownTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8882',
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 3,
  },
});
