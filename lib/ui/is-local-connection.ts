// Both of these connect straight to the hub's own LAN IP, no relay in
// between -- http:// is mDNS/manual entry (see lib/discovery/nearbyHubs.ts
// and hub-select.tsx), and https://<slug>.hub.citinet.cloud is citinet-web's
// own HTTPS bridge (docs/hub-https-bridge.md): a public DNS A record that
// resolves straight to the hub's private LAN IP, just wrapped in a real
// trusted cert so Web Crypto works. Neither ever leaves the LAN. A hub
// whose tunnel_url is instead a genuine public tunnel (a Tailscale Funnel
// *.ts.net URL, a real Cloudflare Tunnel domain) is the only case that's
// actually reachable from anywhere -- that's "Web".
export function isLocalConnection(tunnelUrl: string): boolean {
  return tunnelUrl.startsWith('http://') || /^https:\/\/[^/]+\.hub\.citinet\.cloud(\/|$)/.test(tunnelUrl);
}
