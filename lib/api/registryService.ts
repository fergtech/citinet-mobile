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
