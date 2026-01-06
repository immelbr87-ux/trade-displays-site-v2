// netlify/functions/listings.js
export default async (req) => {
  try {
    // --- Required env vars (set these in Netlify > Site settings > Environment variables)
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN; // Airtable Personal Access Token (PAT)
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || "Listings";
    const AIRTABLE_VIEW = process.env.AIRTABLE_VIEW || "Public_Active";

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return json(500, { error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID env vars" });
    }

    // Optional query params (for later)
    const url = new URL(req.url);
    const pageSize = Math.min(Number(url.searchParams.get("pageSize") || 12), 50);

    // Build Airtable API request (reads only from the view)
    const airtableUrl = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`);
    airtableUrl.searchParams.set("view", AIRTABLE_VIEW);
    airtableUrl.searchParams.set("pageSize", String(pageSize));
    airtableUrl.searchParams.set("sort[0][field]", "created_at");
    airtableUrl.searchParams.set("sort[0][direction]", "desc");

    // Only return the fields your site needs (keeps payload small)
    const FIELDS = [
      "public_id",
      "title",
      "category",
      "brand",
      "model",
      "condition_grade",
      "price",
      "pickup_window_start",
      "pickup_window_end",
      "finish_family",
      "dimensions",
      "key_spec",
      "whats_included",
      "pickup_notes",
      "thumbnail_url",
      "gallery_urls",
      "seller_name"
    ];
    for (const f of FIELDS) airtableUrl.searchParams.append("fields[]", f);

    const r = await fetch(airtableUrl.toString(), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    if (!r.ok) {
      const text = await r.text();
      return json(500, { error: "Airtable request failed", status: r.status, details: text });
    }

    const data = await r.json();

    // Normalize Airtable records -> clean listing objects
    const listings = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      return {
        id: f.public_id || rec.id,
        title: f.title || "",
        category: f.category || "",
        brand: f.brand || "",
        model: f.model || "",
        condition_grade: f.condition_grade || "",
        price: f.price ?? null,
        pickup_window_start: f.pickup_window_start || "",
        pickup_window_end: f.pickup_window_end || "",
        finish_family: f.finish_family || "",
        dimensions: f.dimensions || "",
        key_spec: f.key_spec || "",
        whats_included: f.whats_included || "",
        pickup_notes: f.pickup_notes || "",
        thumbnail_url: f.thumbnail_url || "",
        gallery_urls: f.gallery_urls || "",
        seller_name: f.seller_name || ""
      };
    });

    return json(200, { listings });

  } catch (e) {
    return json(500, { error: "Unhandled error", details: String(e?.message || e) });
  }
};

// Small helper to return JSON with CORS
function json(statusCode, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    }
  });
}
