// netlify/functions/_geo.js
// Lightweight ZIP -> lat/lng lookup + distance helpers.
// Uses the public Zippopotam.us API (no key) and caches in-memory per function instance.

const fetch = require('node-fetch');

const zipCache = new Map();

async function getLatLngFromZip(zip) {
  const z = String(zip || '').trim();
  if (!z) return null;
  if (zipCache.has(z)) return zipCache.get(z);

  const url = `https://api.zippopotam.us/us/${encodeURIComponent(z)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'showroom-market/1.0' } });
  if (!res.ok) {
    zipCache.set(z, null);
    return null;
  }
  const data = await res.json();
  const place = data?.places?.[0];
  if (!place) {
    zipCache.set(z, null);
    return null;
  }
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    zipCache.set(z, null);
    return null;
  }
  const out = { lat, lon };
  zipCache.set(z, out);
  return out;
}

function haversineMiles(a, b) {
  if (!a || !b) return null;
  const R = 3958.7613; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

module.exports = {
  getLatLngFromZip,
  haversineMiles,
};
