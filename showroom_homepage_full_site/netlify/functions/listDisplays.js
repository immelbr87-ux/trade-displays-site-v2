// netlify/functions/listDisplays.js
const { json, airtableQuery, pick } = require("./_lib");

exports.handler = async () => {
  try {
    const data = await airtableQuery({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      apiKey: process.env.AIRTABLE_API_KEY,
      params: {
        view: process.env.AIRTABLE_VIEW || "Public_Active",
      },
    });

    const displays = (data.records || []).map((r) => {
      const f = r.fields || {};

      return {
        id: r.id,
        name: pick(f, ["name", "title", "product_name"], "Showroom Item"),
        description: pick(f, ["description", "details"], ""),
        category: pick(f, ["category"], ""),
        condition: pick(f, ["condition", "grade"], "Grade A"),
        brand: pick(f, ["brand"], ""),
        location: pick(f, ["pickup_address", "location"], "Showroom Location"),
        availability: pick(f, ["availability"], "Available Now"),
        price: Math.round(f.price || 0),
        createdAt: f.created_at || f.createdAt || null,
        views: f.views || 0,
      };
    });

    return json(200, { displays });
  } catch (err) {
    console.error("❌ listDisplays error:", err);
    return json(500, { error: "Failed to load listings" });
  }
};
