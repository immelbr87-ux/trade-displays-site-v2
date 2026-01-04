const Airtable = require("airtable");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    category = "",
    location = "",
    sku = "",
    condition = "Display",
    price,
    qty = 1,
    notes = "",
  } = payload;

  if (!category || !location || typeof price !== "number") {
    return json(400, { error: "Missing required fields: category, location, price(number)" });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE || "Displays";

  if (!apiKey || !baseId) {
    // Fallback: echo (so UI still works even before env vars are set)
    return json(200, {
      created: true,
      warning: "Airtable env vars not set. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in Netlify.",
      data: { category, location, sku, condition, price, qty, notes, createdAt: new Date().toISOString() },
    });
  }

  try {
    Airtable.configure({ apiKey });
    const base = Airtable.base(baseId);

    const rec = await base(tableName).create([
      {
        fields: {
          Category: category,
          Location: location,
          SKU: sku,
          Condition: condition,
          Price: price,
          Qty: qty,
          Notes: notes,
        },
      },
    ]);

    return json(200, {
      created: true,
      id: rec?.[0]?.id,
      fields: rec?.[0]?.fields,
    });
  } catch (err) {
    return json(500, { error: "Airtable create failed", detail: String(err) });
  }
};
