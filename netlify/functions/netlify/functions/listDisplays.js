// netlify/functions/listDisplays.js
// Airtable REST (no npm installs). Works with Airtable PAT.
// Env vars expected:
// AIRTABLE_TOKEN (PAT), AIRTABLE_BASE_ID, AIRTABLE_TABLE, AIRTABLE_VIEW

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY; // fallback if you used older name
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  const view = process.env.AIRTABLE_VIEW || "Public_Active";

  if (!token || !baseId) {
    return json(500, { error: "Missing Airtable env vars", detail: "Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID in Netlify." });
  }

  const q = event.queryStringParameters || {};
  const id = (q.id || "").trim();
  const pageSize = Math.min(50, Math.max(1, Number(q.pageSize || 12)));

  try {
    if (id) {
      const record = await airtableGetRecord({ token, baseId, table, id });
      const listing = mapRecord(record);
      return json(200, { listing });
    }

    const records = await airtableList({ token, baseId, table, view, pageSize });
    const listings = records.map(mapRecord);
    return json(200, { listings });

  } catch (err) {
    return json(500, { error: "Airtable fetch failed", detail: String(err && err.message ? err.message : err) });
  }
};

async function airtableGetRecord({ token, baseId, table, id }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || data?.error || "Airtable record error");
  return data;
}

async function airtableList({ token, baseId, table, view, pageSize }) {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("pageSize", String(pageSize));
  // optional: consistent ordering if you have a field like "Pickup Window Start"
  // params.append("sort[0][field]", "pickup_window_start");
  // params.append("sort[0][direction]", "asc");

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || data?.error || "Airtable list error");
  return Array.isArray(data.records) ? data.records : [];
}

// Map Airtable record -> site listing fields used by market/listing-details/reserve
function mapRecord(rec) {
  const f = rec.fields || {};

  // Airtable attachment field might be an array of {url,...}
  const thumb = pickThumb(f.thumbnail_url || f.thumbnail || f.photo || f.photos);

  return {
    id: rec.id,

    title: f.title || f.Title || "Display Listing",
    category: f.category || f.Category || "",
    condition_grade: (f.condition_grade || f.Grade || f.grade || "").toString().replace("Grade", "").trim() || "",
    price: f.price ?? f.Price ?? "",
    finish_family: f.finish_family || f.Finish || f.finish || "",
    dimensions: f.dimensions || f.Dimensions || "",
    key_spec: f.key_spec || f.KeySpec || f.keySpec || "",
    includes: f.includes || f.Includes || "",
    excludes: f.excludes || f.Excludes || "",
    notes: f.notes || f.Notes || "",

    pickup_window_start: f.pickup_window_start || f.PickupWindowStart || f.pickupStart || f.pickup_start || "",
    pickup_window_end: f.pickup_window_end || f.PickupWindowEnd || f.pickupEnd || f.pickup_end || "",

    thumbnail_url: thumb || "",

    // optional extras if you have them:
    location: f.location || f.Location || "",
    showroom_name: f.showroom_name || f.Showroom || "",
  };
}

function pickThumb(v) {
  // If it's already a URL string
  if (typeof v === "string") return v;

  // Airtable attachments array
  if (Array.isArray(v) && v.length) {
    const first = v[0];
    if (first && typeof first.url === "string") return first.url;
  }
  return "";
}
