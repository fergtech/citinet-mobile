import { useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import Zeroconf, { Service } from 'react-native-zeroconf';

import { getHubInfo, getHubStatus } from '@/lib/api/hubService';
import type { RegistryHub } from '@/lib/api/types';

/**
 * react-native-zeroconf is a native module -- its RNZeroconf binding is
 * simply absent under Expo Go (which only ships a fixed set of pre-linked
 * modules), so both Zeroconf#scan and #stop call straight into `null` and
 * throw uncaught, crashing the whole app (not just this feature) the moment
 * this hook mounts. Checking this before ever touching Zeroconf lets nearby
 * discovery degrade to "not available" instead -- needs a custom dev client
 * (expo-dev-client + eas build / prebuild), not plain `expo start`.
 */
export const isNearbyDiscoveryAvailable = NativeModules.RNZeroconf != null;

// Must match the type/protocol the hub advertises with (api/mdnsAdvertise.js
// in citinet-web: bonjour.publish({ type: 'citinet', protocol: 'tcp', ... })).
const SERVICE_TYPE = 'citinet';
const PROTOCOL = 'tcp';
const DOMAIN = 'local.';

// How often already-discovered hubs get re-polled for live heartbeat data
// (member_count/online_now/uptime) while this hook stays mounted.
const HEARTBEAT_REFRESH_MS = 15_000;

type Enrichment = Pick<RegistryHub, 'name' | 'slug' | 'location' | 'description' | 'member_count' | 'online_now' | 'uptime'>;

/**
 * Maps a resolved mDNS service to the same RegistryHub shape the online
 * registry returns, so both sources can feed the same list/selection UI in
 * hub-select.tsx without it needing to know where a hub came from. Only the
 * bare identity available from the mDNS TXT record (slug/name) -- real
 * identity/liveness data gets layered on top by the enrichment below.
 * tunnel_url is a plain http:// LAN address on purpose -- pairing local
 * discovery with a trusted HTTPS cert is deliberately out of scope for the
 * MVP (see citinet-web's hub_wireless_reach_https_bridge work for that,
 * to be layered in later).
 */
function serviceToHub(service: Service): RegistryHub | null {
  // Prefer an IPv4 address (contains dots) over IPv6 (colons) -- simpler and
  // more universally reachable for a first connection attempt.
  const address = service.addresses.find((a) => a.includes('.')) ?? service.addresses[0];
  if (!address) return null;

  const slug = typeof service.txt.slug === 'string' && service.txt.slug ? service.txt.slug : service.name;
  const name = typeof service.txt.name === 'string' && service.txt.name ? service.txt.name : service.name;

  return {
    id: `${address}:${service.port}`,
    name,
    slug,
    location: '',
    tunnel_url: `http://${address}:${service.port}`,
    online: true,
  };
}

/**
 * Live list of Citinet hubs found via mDNS on the current local network,
 * enriched with real identity and heartbeat data -- the "I don't know an
 * address, just find what's nearby" path, complementing the online registry
 * and manual entry in hub-select.tsx. Scans for the lifetime of the mounting
 * component; stops and cleans up listeners on unmount.
 *
 * Enrichment reuses the hub's own existing GET /api/info (identity -- real
 * name/slug/description/member_count, fetched once per hub) and GET
 * /api/status (heartbeat -- online_now/uptime, re-polled on an interval) --
 * no new server endpoint, both already used elsewhere in this app and in
 * citinet-web's own join flow. A hub that hasn't answered yet, or is
 * temporarily unreachable, just keeps showing its last-known (or bare mDNS)
 * data rather than disappearing or erroring the whole list.
 */
export function useNearbyHubs(): RegistryHub[] {
  const [hubs, setHubs] = useState<RegistryHub[]>([]);
  const enrichmentRef = useRef<Map<string, Partial<Enrichment>>>(new Map());
  const identityFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isNearbyDiscoveryAvailable) {
      console.warn(
        '[nearbyHubs] react-native-zeroconf has no native binding in this build (e.g. Expo Go) -- ' +
          'nearby hub discovery is disabled. Build a development client to enable it.'
      );
      return;
    }

    const zeroconf = new Zeroconf();

    const applyEnrichment = (id: string, patch: Partial<Enrichment>) => {
      enrichmentRef.current.set(id, { ...enrichmentRef.current.get(id), ...patch });
      setHubs((prev) => prev.map((hub) => (hub.id === id ? { ...hub, ...enrichmentRef.current.get(id) } : hub)));
    };

    const recompute = () => {
      const resolved = Object.values(zeroconf.getServices())
        .map(serviceToHub)
        .filter((hub): hub is RegistryHub => hub !== null)
        .map((hub) => ({ ...hub, ...enrichmentRef.current.get(hub.id) }));
      setHubs(resolved);

      // Layer 2 (identity) -- one-time per hub, real data instead of the
      // bare TXT-record fallback.
      for (const hub of resolved) {
        if (identityFetchedRef.current.has(hub.id)) continue;
        identityFetchedRef.current.add(hub.id);
        getHubInfo(hub.tunnel_url)
          .then((info) =>
            applyEnrichment(hub.id, {
              name: info.hub_name || hub.name,
              slug: info.hub_slug || hub.slug,
              location: info.location,
              description: info.description,
              member_count: info.member_count,
            })
          )
          .catch(() => {
            /* not enriched yet -- row still shows the bare mDNS name */
          });
      }
    };

    zeroconf.on('resolved', recompute);
    // A service disappearing is reported by its raw mDNS instance name, not
    // our synthesized id -- rebuilding from getServices() (which the library
    // already keeps in sync) is simpler and more correct than trying to
    // reverse-map name -> id ourselves.
    zeroconf.on('remove', recompute);
    zeroconf.on('error', (err) => {
      console.error('[nearbyHubs] zeroconf error', err);
    });

    zeroconf.scan(SERVICE_TYPE, PROTOCOL, DOMAIN);

    // Layer 3 (heartbeat) -- re-poll every currently-known hub's live status
    // on an interval, independent of mDNS resolve/remove events, so
    // online_now/uptime stay fresh for as long as this screen is open.
    const heartbeatTimer = setInterval(() => {
      const current = Object.values(zeroconf.getServices())
        .map(serviceToHub)
        .filter((hub): hub is RegistryHub => hub !== null);
      for (const hub of current) {
        getHubStatus(hub.tunnel_url)
          .then((status) =>
            applyEnrichment(hub.id, {
              online_now: status.online_now,
              uptime: status.uptime,
            })
          )
          .catch(() => {
            /* hub temporarily unreachable -- leave last-known heartbeat displayed */
          });
      }
    }, HEARTBEAT_REFRESH_MS);

    return () => {
      zeroconf.stop();
      zeroconf.removeDeviceListeners();
      clearInterval(heartbeatTimer);
    };
  }, []);

  return hubs;
}
