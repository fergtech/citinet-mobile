import { useEffect, useMemo, useRef } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { AtlasPin, AtlasPinCategory } from '@/lib/api/types';
import { ATLAS_CATEGORIES } from '@/lib/atlas/categories';

type MarkerData = { id: string; latitude: number; longitude: number; color: string; iconPath: string };

// Real Material Icons glyph paths (google/material-design-icons, the same
// icon set IconSymbol uses elsewhere via MaterialIcons) — rendered as inline
// SVG in the marker HTML below. Markers live inside the WebView's own DOM, not
// the RN component tree, so IconSymbol itself can't be used here directly;
// this is the equivalent for that context — real vector icons, not emoji.
const CATEGORY_ICON_PATHS: Record<AtlasPinCategory, string> = {
  meetup:
    'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  safety: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  avoid:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z',
  infrastructure:
    'M17,11V3H7v4H3v14h8v-4h2v4h8V11H17z M7,19H5v-2h2V19z M7,15H5v-2h2V15z M7,11H5V9h2V11z M11,15H9v-2h2V15z M11,11H9V9h2 V11z M11,7H9V5h2V7z M15,15h-2v-2h2V15z M15,11h-2V9h2V11z M15,7h-2V5h2V7z M19,19h-2v-2h2V19z M19,15h-2v-2h2V15z',
  poi: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  aid: 'M16.48,10.41c-0.39,0.39-1.04,0.39-1.43,0l-4.47-4.46l-7.05,7.04l-0.66-0.63c-1.17-1.17-1.17-3.07,0-4.24l4.24-4.24 c1.17-1.17,3.07-1.17,4.24,0L16.48,9C16.87,9.39,16.87,10.02,16.48,10.41z M17.18,8.29c0.78,0.78,0.78,2.05,0,2.83 c-1.27,1.27-2.61,0.22-2.83,0l-3.76-3.76l-5.57,5.57c-0.39,0.39-0.39,1.02,0,1.41c0.39,0.39,1.02,0.39,1.42,0l4.62-4.62l0.71,0.71 l-4.62,4.62c-0.39,0.39-0.39,1.02,0,1.41c0.39,0.39,1.02,0.39,1.42,0l4.62-4.62l0.71,0.71l-4.62,4.62c-0.39,0.39-0.39,1.02,0,1.41 c0.39,0.39,1.02,0.39,1.41,0l4.62-4.62l0.71,0.71l-4.62,4.62c-0.39,0.39-0.39,1.02,0,1.41c0.39,0.39,1.02,0.39,1.41,0l8.32-8.34 c1.17-1.17,1.17-3.07,0-4.24l-4.24-4.24c-1.15-1.15-3.01-1.17-4.18-0.06L17.18,8.29z',
  green:
    'M6.05,8.05c-2.73,2.73-2.73,7.15-0.02,9.88c1.47-3.4,4.09-6.24,7.36-7.93c-2.77,2.34-4.71,5.61-5.39,9.32 c2.6,1.23,5.8,0.78,7.95-1.37C19.43,14.47,20,4,20,4S9.53,4.57,6.05,8.05z',
};

// Real Leaflet.js + OpenStreetMap tiles inside a WebView — react-native-maps
// would need a dev client (this project is Expo Go only, see project memory),
// this stays on Expo Go while still rendering genuine map tiles, not a static
// image or placeholder grid. The HTML shell loads once; pin/marker updates
// after that go through injectJavaScript rather than reloading the page, so
// filtering categories or dropping a pending marker doesn't flash/reload the
// whole map.
const HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #e5e7eb; }
  .atlas-marker { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; }
  .atlas-marker svg { width: 16px; height: 16px; }
  .atlas-marker-pending { width: 30px; height: 30px; border-radius: 50%; background: #2164f3; border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: true }).setView([0, 0], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  var markers = {};
  var pendingMarker = null;
  var placingMode = false;

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  window.setPins = function(pins) {
    Object.keys(markers).forEach(function(id) { map.removeLayer(markers[id]); });
    markers = {};
    pins.forEach(function(p) {
      var svg = '<svg viewBox="0 0 24 24" fill="#fff"><path d="' + p.iconPath + '"/></svg>';
      var icon = L.divIcon({
        className: '',
        html: '<div class="atlas-marker" style="background:' + p.color + '">' + svg + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      var m = L.marker([p.latitude, p.longitude], { icon: icon }).addTo(map);
      (function(id) { m.on('click', function() { post({ type: 'markerPress', id: id }); }); })(p.id);
      markers[p.id] = m;
    });
  };

  window.setPending = function(lat, lng) {
    if (pendingMarker) { map.removeLayer(pendingMarker); pendingMarker = null; }
    if (lat !== null && lng !== null) {
      var icon = L.divIcon({ className: '', html: '<div class="atlas-marker-pending"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
      pendingMarker = L.marker([lat, lng], { icon: icon }).addTo(map);
    }
  };

  window.setPlacingMode = function(on) { placingMode = on; };
  window.recenter = function(lat, lng, zoom) { map.setView([lat, lng], zoom); };

  // Fits the viewport to show every pin at once (with padding), instead of a
  // fixed zoom that can land anywhere from "too close to see pins" to "the
  // whole country" depending on how spread out they are. Falls back to a
  // plain centered view when there's nothing (or only one thing) to fit.
  window.fitToPins = function(pins, fallbackLat, fallbackLng, fallbackZoom) {
    if (!pins.length) { map.setView([fallbackLat, fallbackLng], fallbackZoom); return; }
    if (pins.length === 1) { map.setView([pins[0].latitude, pins[0].longitude], 15); return; }
    var bounds = L.latLngBounds(pins.map(function(p) { return [p.latitude, p.longitude]; }));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  };

  map.on('click', function(e) {
    if (placingMode) post({ type: 'mapPress', lat: e.latlng.lat, lng: e.latlng.lng });
  });

  post({ type: 'ready' });
</script>
</body></html>`;

export function LeafletMap({
  pins,
  center,
  zoom = 14,
  fitToPins = false,
  placingMode = false,
  pendingMarker = null,
  onMarkerPress,
  onMapPress,
  style,
}: {
  pins: AtlasPin[];
  center: [number, number];
  zoom?: number;
  /** Auto-fit the viewport to show every pin at once (falls back to center/zoom when there are 0-1 pins), instead of trusting a fixed zoom. */
  fitToPins?: boolean;
  placingMode?: boolean;
  pendingMarker?: [number, number] | null;
  onMarkerPress?: (pinId: string) => void;
  onMapPress?: (lat: number, lng: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);

  const markerData: MarkerData[] = useMemo(
    () =>
      pins.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        color: ATLAS_CATEGORIES[p.category].color,
        iconPath: CATEGORY_ICON_PATHS[p.category],
      })),
    [pins]
  );

  function inject(js: string) {
    webviewRef.current?.injectJavaScript(`${js}; true;`);
  }

  useEffect(() => {
    if (!readyRef.current) return;
    inject(`window.setPins(${JSON.stringify(markerData)})`);
    if (fitToPins) inject(`window.fitToPins(${JSON.stringify(markerData)}, ${center[0]}, ${center[1]}, ${zoom})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerData, fitToPins]);

  useEffect(() => {
    if (readyRef.current) inject(`window.setPending(${pendingMarker ? pendingMarker[0] : 'null'}, ${pendingMarker ? pendingMarker[1] : 'null'})`);
  }, [pendingMarker]);

  useEffect(() => {
    if (readyRef.current) inject(`window.setPlacingMode(${placingMode})`);
  }, [placingMode]);

  useEffect(() => {
    if (readyRef.current && !fitToPins) inject(`window.recenter(${center[0]}, ${center[1]}, ${zoom})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], fitToPins]);

  function handleMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        readyRef.current = true;
        inject(`window.setPins(${JSON.stringify(markerData)})`);
        if (fitToPins) {
          inject(`window.fitToPins(${JSON.stringify(markerData)}, ${center[0]}, ${center[1]}, ${zoom})`);
        } else {
          inject(`window.recenter(${center[0]}, ${center[1]}, ${zoom})`);
        }
        if (pendingMarker) inject(`window.setPending(${pendingMarker[0]}, ${pendingMarker[1]})`);
        if (placingMode) inject(`window.setPlacingMode(true)`);
      } else if (msg.type === 'markerPress') {
        onMarkerPress?.(msg.id);
      } else if (msg.type === 'mapPress') {
        onMapPress?.(msg.lat, msg.lng);
      }
    } catch {
      // ignore malformed bridge messages
    }
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ html: HTML }}
      onMessage={handleMessage}
      style={[styles.webview, style]}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    backgroundColor: '#e5e7eb',
  },
});
