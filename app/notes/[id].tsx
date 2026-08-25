import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createNote, getNote, updateNote } from '@/lib/api/hubService';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';

type Visibility = 'private' | 'hub' | 'public';

// Intended design (per the user, 2026-08-21): any member can make their own
// note reachable via a plain link — sharing a note you wrote isn't a
// moderation action. Only blog publishing (a separate row below, once this
// tier is selected) is admin/mod-exclusive. The live server currently 403s
// non-admins on is_web_public too (confirmed straight from citinet's PATCH
// /api/notes/:id handler) — that's being treated as a server-side gap to
// close, not something to route around here, so handleDone surfaces that
// specific 403 as a clear explanation rather than a raw error.
const VISIBILITY_CYCLE: Visibility[] = ['private', 'hub', 'public'];
// Pill labels are kept short on purpose — the header is a fixed single row
// (Cancel / pill / Done) and a longer label ("Public link") wraps the pill
// onto its own line and breaks that layout. Full meaning lives in `hint`
// below the header instead. Matches citinet web's real popover intent
// ("Only me" / "Hub members" / "Anyone with link") without the ambiguity of
// a bare "Public" — this tier is "shareable via a plain link, no hub account
// needed," a distinct axis from blog (*listed/discoverable*, not just
// reachable — see the blog row below, which only appears once this tier is
// selected).
const VISIBILITY_META: Record<Visibility, { icon: IconSymbolName; label: string; hint?: string }> = {
  private: { icon: 'lock.fill', label: 'Only me' },
  hub: { icon: 'person.2.fill', label: 'Hub' },
  public: {
    icon: 'globe',
    label: 'Link',
    hint: 'Viewable by anyone with the link — no hub account needed.',
  },
};

// Icon-only placeholders — not wired to real rich-text formatting yet. Picking
// an editor (TipTap/markdown) and wiring these up is a separate, larger task.
const TOOLBAR_ICONS: IconSymbolName[] = [
  'bold',
  'italic',
  'textformat',
  'list.bullet',
  'list.number',
  'checklist',
  'link',
  'chevron.left.forwardslash.chevron.right',
  'photo',
  'video.fill',
];

function noteVisibility(isPublic: boolean, isWebPublic: boolean): Visibility {
  if (isWebPublic) return 'public';
  if (isPublic) return 'hub';
  return 'private';
}

export default function NoteEditorScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { decryptNote, encryptNote } = useE2EKeys();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [blogPublished, setBlogPublished] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // citinet's real frontend route for a public note — a central portal
  // deployment (not this hub's own tunnel URL), parametrized by hub slug so
  // one deployment can serve any hub's shared notes. `isNew` guard: only a
  // saved note has an id worth sharing.
  const shareUrl = !isNew && session ? `https://citinet.cloud/share-note/${session.hub.slug}/${id}` : null;

  async function handleCopyLink() {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleShareLink() {
    if (!shareUrl) return;
    Share.share(Platform.OS === 'ios' ? { url: shareUrl } : { message: shareUrl });
  }

  useEffect(() => {
    if (isNew || !session) return;
    let cancelled = false;
    (async () => {
      try {
        const note = await getNote(session.hub.tunnelUrl, session.token, id);
        const decrypted = await decryptNote(note.body_plain);
        if (cancelled) return;
        setTitle(note.title);
        setBody(decrypted?.plain ?? '');
        setVisibility(noteVisibility(note.is_public, note.is_web_public));
        setBlogPublished(note.is_blog_published);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this note.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, session]);

  function cycleVisibility() {
    const current = VISIBILITY_CYCLE.indexOf(visibility);
    const next = VISIBILITY_CYCLE[(current === -1 ? 0 : current + 1) % VISIBILITY_CYCLE.length];
    setVisibility(next);
  }

  async function handleDone() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const enc = await encryptNote({ rich: null, plain: body });
      const finalTitle = title.trim() || 'Untitled';
      const isPublic = visibility !== 'private';
      const isWebPublic = visibility === 'public';
      // Blog publishing requires web-public as a prerequisite (matches
      // citinet web's own gating) — force it off if that's not the case,
      // regardless of what the now-hidden toggle was last left at.
      const finalBlogPublished = isWebPublic && session.isAdmin && blogPublished;
      const webFields = isWebPublic ? { web_body_plain: body, web_body_rich: null } : {};

      if (isNew) {
        const created = await createNote(session.hub.tunnelUrl, session.token, {
          title: finalTitle,
          body_plain: enc.body_plain,
          body_rich: enc.body_rich,
        });
        if (isPublic) {
          await updateNote(session.hub.tunnelUrl, session.token, created.id, {
            is_public: isPublic,
            is_web_public: isWebPublic,
            is_blog_published: finalBlogPublished,
            ...webFields,
          });
        }
      } else {
        await updateNote(session.hub.tunnelUrl, session.token, id, {
          title: finalTitle,
          body_plain: enc.body_plain,
          body_rich: enc.body_rich,
          is_public: isPublic,
          is_web_public: isWebPublic,
          is_blog_published: finalBlogPublished,
          ...webFields,
        });
      }
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save this note.";
      // This hub's server currently restricts is_web_public to admins/mods,
      // same as blog publishing — a real gap vs. the intended design (any
      // member should be able to share a link to their own note), not a bug
      // in this app. Server's own error message already says as much; just
      // pointing at it plainly rather than treating it like an unknown failure.
      setError(message.includes('public web') ? `${message} Ask a hub admin or moderator to publish it for you.` : message);
      setSaving(false);
    }
  }

  if (!session) return null;

  const vis = VISIBILITY_META[visibility];

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Cancel" accessibilityRole="button">
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={cycleVisibility} style={styles.visPill} disabled={loading}>
          <IconSymbol name={vis.icon} size={13} color={Colors[colorScheme].icon} />
          <ThemedText style={styles.visPillLabel}>{vis.label}</ThemedText>
        </Pressable>
        <Pressable onPress={handleDone} disabled={loading || saving} style={[styles.doneButton, { opacity: loading || saving ? 0.5 : 1 }]}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <ThemedText style={styles.doneLabel} lightColor="#fff" darkColor="#fff">
              Done
            </ThemedText>
          )}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {vis.hint && <ThemedText style={styles.visHint}>{vis.hint}</ThemedText>}

          {visibility === 'public' && shareUrl && (
            <View style={styles.shareRow}>
              <IconSymbol name="link" size={16} color={Colors[colorScheme].icon} />
              <ThemedText numberOfLines={1} style={styles.shareRowUrl}>
                {shareUrl.replace('https://', '')}
              </ThemedText>
              <Pressable onPress={handleCopyLink} hitSlop={10} accessibilityLabel="Copy link">
                <IconSymbol name={copied ? 'checkmark.circle.fill' : 'doc.on.doc'} size={17} color={copied ? Brand : Colors[colorScheme].icon} />
              </Pressable>
              <Pressable onPress={handleShareLink} hitSlop={10} accessibilityLabel="Share link">
                <IconSymbol name="square.and.arrow.up" size={18} color={Colors[colorScheme].icon} />
              </Pressable>
            </View>
          )}

          {visibility === 'public' && session.isAdmin && (
            <Pressable onPress={() => setBlogPublished((v) => !v)} style={styles.blogRow}>
              <IconSymbol name="newspaper.fill" size={18} color={blogPublished ? Brand : Colors[colorScheme].icon} />
              <View style={styles.blogRowText}>
                <ThemedText style={[styles.blogRowLabel, blogPublished && { color: Brand }]}>
                  {blogPublished ? 'Listed on public blog' : 'Publish to blog'}
                </ThemedText>
                <ThemedText style={styles.blogRowMeta}>Admin/mod only</ThemedText>
              </View>
              <Switch value={blogPublished} onValueChange={setBlogPublished} trackColor={{ true: Brand }} />
            </Pressable>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
            {TOOLBAR_ICONS.map((name, i) => (
              <Pressable key={`${name}-${i}`} style={styles.toolbarButton} accessibilityLabel="Formatting (coming soon)">
                <IconSymbol name={name} size={19} color={Colors[colorScheme].icon} />
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.body}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={Colors[colorScheme].icon}
              style={[styles.titleInput, { color: Colors[colorScheme].text }]}
            />
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Start writing…"
              placeholderTextColor={Colors[colorScheme].icon}
              multiline
              textAlignVertical="top"
              style={[styles.bodyInput, { color: Colors[colorScheme].text }]}
            />
          </View>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    gap: 10,
  },
  cancel: {
    fontSize: 15,
    opacity: 0.7,
  },
  visPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: '#8881',
  },
  visPillLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  visHint: {
    fontSize: 11.5,
    opacity: 0.5,
    lineHeight: 15,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  doneButton: {
    backgroundColor: Brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  doneLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  shareRowUrl: {
    flex: 1,
    fontSize: 12.5,
    opacity: 0.7,
  },
  blogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8881',
  },
  blogRowText: {
    flex: 1,
    gap: 1,
  },
  blogRowLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  blogRowMeta: {
    fontSize: 11.5,
    opacity: 0.5,
  },
  toolbar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  toolbarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  toolbarButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  titleInput: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 10,
    padding: 0,
  },
  bodyInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    padding: 0,
  },
});
