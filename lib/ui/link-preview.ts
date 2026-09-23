// Mirrors citinet-web's src/app/components/LinkPreview.tsx parseMessageLinks/
// hostnameOf — same regex, same behavior, so a link posted from either client
// renders identically. Kept dependency-free (no React) so it's usable from
// both the message list and the link-preview-card component.

const URL_REGEX = /https?:\/\/[^\s]+/g;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

/** Splits a message body into its link-stripped text and the URLs it contained
 *  (in order, deduplicated) — the URLs get rendered as cards instead. */
export function parseMessageLinks(body: string): { text: string; urls: string[] } {
  const found = body.match(URL_REGEX) ?? [];
  const urls: string[] = [];
  let text = body;
  for (const raw of found) {
    const url = raw.replace(TRAILING_PUNCTUATION, '');
    if (url && !urls.includes(url)) urls.push(url);
    text = text.split(raw).join('');
  }
  return { text: text.trim(), urls };
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}
