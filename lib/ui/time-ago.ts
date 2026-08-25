export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// For a future deadline (e.g. a poll's closes_at) rather than a past
// timestamp — null once it's passed, so callers can switch to a "Closed" label.
export function timeLeft(iso: string): string | null {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return null;
  const days = Math.floor(diffMs / 86400000);
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours > 0) return `${hours}h left`;
  const minutes = Math.floor(diffMs / 60000);
  return `${Math.max(1, minutes)}m left`;
}
