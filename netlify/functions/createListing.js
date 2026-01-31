// netlify/functions/createListing.js
// Creates a new listing in Airtable.
// Optional protection: set CREATE_LISTING_TOKEN and send it as
//   Authorization: Bearer <token>  OR  x-listing-token: <token>
//
// Required env vars:
//   AIRTABLE_BASE_ID
//   AIRTABLE_API_KEY

const fetch = require("node-fetch");
const { json } = require("./_lib");

function getToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return (h["x-listing-token"] || h["X-Listing-Token"] || "").trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Listing-Token",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  try {
    const requiredToken = process.env.CREATE_LISTING_TOKEN;
    if (requiredToken) {
      const provided = getToken(event);
      if (!provided || provided !== requiredToken) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
      }
    }

    const body = JSON.parse(event.body || "{}");

    const fields = {
      title: body.title || body.product_name || "",
      brand: body.brand || "",
      sku: body.sku || body.model_number || "",
      category: body.category || "",
      subcategory: body.subcategory || "",
      description: body.description || "",
      price: body.price != null ? Number(body.price) : null,
      condition_grade: body.condition_grade || body.condition || "",
      pickup_location: body.pickup_location || body.location || "",
      pickup_instructions: body.pickup_instructions || "",
      showroom_name: body.showroom_name || "",
      showroom_email: body.showroom_email || body.seller_email || "",
      stripe_account_id: body.stripe_account_id || "",
      status: "Active",
      created_at: new Date().toISOString()
    };

    // Remove null/empty strings to avoid cluttering Airtable
    Object.keys(fields).forEach((k) => {
      const v = fields[k];
      if (v === null || v === undefined) delete fields[k];
      if (typeof v === "string" && v.trim() === "") delete fields[k];
    });

    // Attachments: allow { photos: [{url:...}, ...] } or {photo_urls:[...]}
    if (Array.isArray(body.photos) && body.photos.length) {
      fields.photos = body.photos.filter(p => p && p.url).map(p => ({ url: p.url }));
    } else if (Array.isArray(body.photo_urls) && body.photo_urls.length) {
      fields.photos = body.photo_urls.filter(Boolean).map(u => ({ url: u }));
    }

    if (!process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Airtable env vars" }) };
    }

    const res = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("createListing Airtable error:", data);
      return { statusCode: res.status, headers, body: JSON.stringify({ error: "Airtable create failed", detail: data }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (err) {
    console.error("createListing error:", err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Create listing failed" }) };
  }
};
