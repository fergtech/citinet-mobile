import { RegistryHub } from './types';

const REGISTRY_URL = 'https://raw.githubusercontent.com/fergtech/citinet-registry/main/registry.json';

export async function getHubs(): Promise<RegistryHub[]> {
  const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error("Couldn't load the hub directory. Try again in a moment.");
  }
  const data = await res.json();
  return Array.isArray(data.hubs) ? data.hubs : [];
}

// Mirrors citinet web's own isHubRestarting (registryService.ts) — the
// registry snapshot this reads from is only refreshed periodically, so a
// stale restarting_since that never got cleared by the hub's next heartbeat
// shouldn't strand a hub as "Restarting" in the Directory forever.
const RESTART_SIGNAL_TTL_MS = 15 * 60 * 1000;

export function isHubRestarting(hub: RegistryHub): boolean {
  if (!hub.restarting_since) return false;
  const since = new Date(hub.restarting_since).getTime();
  if (Number.isNaN(since)) return false;
  return Date.now() - since < RESTART_SIGNAL_TTL_MS;
}
