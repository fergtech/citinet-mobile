# Digital pheromone / nearby hub discovery

Goal: a phone with Citinet open should sense a hub is nearby with zero typing
— "presence" (Layer 1) up through richer signals (identity, heartbeat,
activity, trust, federation — Layers 2-7), surfaced passively rather than
only inside a manual search screen (Layer 8). Full layer breakdown came from
a Copilot-assisted planning session; only Layers 1-3 are built so far.

## What's built

- **Layer 1 (Presence)** — `H:\Apps\citinet-web\api\mdnsAdvertise.js`
  publishes `_citinet._tcp` via `bonjour-service`, TXT record carries
  `slug`/`name`.
- **Layer 2 (Identity)** — no dedicated `/api/pheromone` endpoint; reuses the
  hub's existing `GET /api/info` (DB-config-aware name/slug/location/
  description/member_count).
- **Layer 3 (Heartbeat)** — reuses `GET /api/status` (online_now/uptime),
  re-polled every 15s while the hub-select screen is mounted.
- Mobile: `lib/discovery/nearbyHubs.ts` (`useNearbyHubs()` hook) does the
  scan + enrichment; `lib/api/hubService.ts` has `getHubInfo`/`getHubStatus`;
  `app/(auth)/hub-select.tsx` renders a live "Nearby" section above the
  registry-driven "Directory" list, plus a manual-entry fallback (confirmed
  working end-to-end against the real deployment).
- `app.json` has the iOS Bonjour entitlements (`NSBonjourServices`,
  `NSLocalNetworkUsageDescription`) and Android multicast/WiFi-state
  permissions. Requires a dev-client build (`expo-dev-client` + EAS/prebuild)
  — `react-native-zeroconf` has no binding under plain Expo Go, and
  `isNearbyDiscoveryAvailable` in `nearbyHubs.ts` guards against that.

## Deployment reality (important — don't assume the repo's own docker-compose.yml is live)

The real running hub is **not** governed by `H:\Apps\citinet-web`'s own
`docker-compose.yml`. It's a separately-maintained deployment at
`C:\Users\zee\citinet-hub\docker-compose.yml`, which only uses the repo as a
Docker build context for the `citinet-api` image. Real identity: `HUB_SLUG=
hub1`, DB-overridden display name `genesis`, `LAN_IP=10.0.0.188`,
`API_PORT=9090`.

Two changes were needed there to make discovery real:

1. **`citinet-mdns` runs as a native Windows process, not a Docker sidecar.**
   The original plan called for `network_mode: host`, but on this Docker
   Desktop/WSL2 host that only exposes WSL2's internal virtual NIC
   (`192.168.65.x`), never the real LAN — confirmed empirically. Instead run
   `node api/mdnsAdvertise.js` directly on Windows (same pattern as this
   deployment's existing `dns-bridge/responder.js`), with `HUB_NAME`,
   `HUB_SLUG`, `PORT=9090`, and **`LAN_IP=10.0.0.188`** set.
   - **`LAN_IP` matters**: without it, `multicast-dns` binds to whatever
     interface has the OS's default route — on this host that's a VPN
     adapter (Tailscale/NordLynx both had a lower interface metric than the
     physical Ethernet adapter), not the LAN. The advertisement then only
     ever reached processes on the same host, never an actual phone.
     `mdnsAdvertise.js` now passes `{ interface: process.env.LAN_IP }` to
     `new Bonjour(...)` to pin it correctly.
   - **Not yet persistent.** Currently started ad-hoc in this session
     (`node mdnsAdvertise.js` in the background) — it will not survive a
     reboot. Needs a proper Windows Scheduled Task, matching the
     `CitinetCaddyWatchdog` pattern already used for `watchdog-caddy.ps1`.
2. **`citinet-api`'s port is now also bound to the LAN**, not just
   `127.0.0.1`. `docker-compose.yml`'s `citinet-api` service ports section
   has an added `"${LAN_IP}:${API_PORT:-9090}:9090"` line — deliberate
   HTTP-for-MVP scope decision (agreed early on), the HTTPS bridge
   (`dns-bridge` + `cert-broker.js`/`certAgent.js` + Caddy TLS for
   `hub1.hub.citinet.cloud`) remains the primary/trusted path.

## Known limitation: mDNS resolve is unreliable across WiFi extenders/mesh

Confirmed live: the mDNS *browse* (PTR discovery) reaches the phone fine —
iOS's `NSNetServiceBrowser` fires `didFindService`. The *resolve* step
(`resolveWithTimeout:5.0` in `RNZeroconf.m`, fetching actual SRV/A records)
times out (`NSNetServicesErrorCode -72007`) when the phone is on WiFi through
an **extender** (tested topology: phone → xFi Gateway WiFi → wireless
backhaul → EAX12 extender → Ethernet → hub PC). Regular unicast HTTP across
the same path works fine (manual entry to `10.0.0.188:9090` succeeded) — this
is specifically non-unicast (multicast/broadcast) traffic being dropped or
throttled across the extender's backhaul, a widely-reported issue for
Bonjour/AirPlay/Chromecast on this class of hardware, not something fixable
from the app or hub side.

**Fixed alongside this**: `lib/discovery/nearbyHubs.ts` originally assumed
`service.addresses` always exists and picked only the first IPv4-looking
address (unsound — a multi-homed advertiser reports every interface,
including unreachable Docker/WSL bridges; ordering isn't guaranteed). Now
tries every candidate address in order with a 2.5s timeout each
(`CANDIDATE_PROBE_TIMEOUT_MS`), and tolerates a service stuck "found but
never resolved" (addresses `undefined`) instead of throwing — that crash was
taking over the screen with a repeating red-box error before this fix.

## Working fallbacks (don't regress these)

- **Manual entry** — confirmed working end-to-end against the real
  deployment. This is the reliable path on flaky-multicast networks today.
- **Online registry** — unaffected by any of the above.

## Considered, not built

- **UDP broadcast beacon** (hub sends a periodic JSON payload to the
  subnet broadcast address, phone passively listens). Copilot's suggestion.
  Real risk: broadcast is still non-unicast traffic at the 802.11 radio
  level — likely hits the *same* extender-backhaul throttling that broke
  mDNS resolve, for the same underlying reason. Worth testing, not a
  guaranteed fix. Needs a new native UDP module on mobile (none currently in
  `package.json`) — a full EAS rebuild, not a JS hot-reload.
- **BLE advertising** (hub advertises via Bluetooth LE, phone scans).
  Genuinely topology-independent — sidesteps WiFi/routing entirely, and
  fits passive background awareness (Layer 8) better than any IP-based
  approach since iOS restricts background BLE far less than background
  network scanning. Confirmed the hub PC has working BLE hardware. Real
  costs: no Node.js library for BLE *peripheral*/advertising role on
  Windows (unlike `bonjour-service` for mDNS) — the real path is WinRT via
  PowerShell; mobile needs a new native BLE central module (e.g.
  `react-native-ble-plx`) and another full rebuild; and range is room-scale
  (~10-30ft indoors), not building/network-scale, so it proves "near the
  physical hub machine," not "on the hub's network" — a narrower guarantee
  than WiFi-based discovery. Treat as a complementary layer, not a
  replacement, if pursued.
- **Topology fix**: wiring the hub PC directly to the xFi Gateway instead of
  through the EAX12 extender would likely fix mDNS resolve outright (removes
  the flaky hop). Not done — physical/logistics decision, not code.

## Not started

Layers 4-8 (activity/trail/trust/federation/passive background awareness)
and a dedicated `/api/pheromone` endpoint bundling identity+heartbeat+
activity+trust+federation in one call instead of the current two
(`/api/info` + `/api/status`).
