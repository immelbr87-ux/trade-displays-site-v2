// netlify/functions/listings.js
// Supports:
//   GET /.netlify/functions/listings                -> list from view
//   GET /.netlify/functions/listings?id=recXXXX     -> single record by id

const AIRTABLE_API = "https://api.airtable.com/v0";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function pickEnv() {
  // Accept either naming convention
  const token =
    process.env.AIRTABLE_TOKEN ||
    process.env.AIRTABLE_API_TOKEN ||
    process.env.AIRTABLE_PAT;

  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  const view = process.env.AIRTABLE_VIEW || "Public_Active";

  return { token, baseId, table, view };
}

function mapRecord(rec) {
  const f = rec.fields || {};

  // Keep these "API-safe" keys stable so you can migrate off Airtable later without pain.
  return {
    id: rec.id,
    title: f.Title || f.title || "",
    category: f.Category || f.category || "",
    condition_grade: f.Condition || f.condition || f["Condition Grade"] || "",
    price: f.Price ?? f.price ?? "",
    location_text: f.Location || f.location || f["City / State"] || "",
    finish_family: f["Finish Family"] || f.finish_family || "",
    dimensions: f.Dimensions || f.dimensions || "",
    key_spec: f["Rough-In / Key Spec"] || f.key_spec || f["Key Spec"] || "",
    whats_included: f["What's Included"] || f.whats_included || "",
    pickup_window_start: f["Pickup Window Start"] || f.pickup_window_start || "",
    pickup_window_end: f["Pickup Window End"] || f.pickup_window_end || "",
    thumbnail_url: f["Thumbnail URL"] || f.thumbnail_url || "",
    gallery_urls: f["Gallery URLs"] || f.gallery_urls || "",
    status: f.Status || f.status || "",
    created_at: f.createdAt || f["createdAt"] || "",
  };
}

async function airtableFetch(url, token) {
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || "Airtable request failed";
    const detail = data?.error || data;
    throw new Error(`${msg} :: ${JSON.stringify(detail)}`);
  }

  return data;
}

exports.handler = async (event) => {
  try {
    const { token, baseId, table, view } = pickEnv();
    if (!token || !baseId) {
      return json(500, {
        error: "Missing Airtable env vars. Set AIRTABLE_TOKEN (or AIRTABLE_API_TOKEN) and AIRTABLE_BASE_ID in Netlify.",
      });
    }

    const params = event.queryStringParameters || {};
    const id = params.id;
    const pageSize = Math.min(Number(params.pageSize || 12), 50);

    // Single record lookup
    if (id) {
      const url = `${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
      const rec = await airtableFetch(url, token);
      return json(200, { listing: mapRecord(rec) });
    }

    // View listing
    const url =
      `${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}` +
      `?view=${encodeURIComponent(view)}` +
      `&pageSize=${encodeURIComponent(pageSize)}`;

    const data = await airtableFetch(url, token);
    const records = Array.isArray(data.records) ? data.records : [];
    return json(200, { listings: records.map(mapRecord) });

  } catch (err) {
    console.error(err);
    return json(500, { error: String(err.message || err) });
  }
};
