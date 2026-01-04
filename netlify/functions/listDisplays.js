const Airtable = require("airtable");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE || "Displays";

  const q = event.queryStringParameters || {};
  const category = (q.category || "").trim();
  const location = (q.location || "").trim();
  const sku = (q.sku || "").trim();
  const maxPrice = q.maxPrice ? Number(q.maxPrice) : null;

  if (!apiKey || !baseId) {
    return json(200, {
      items: [],
      warning: "Airtable env vars not set. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in Netlify.",
    });
  }

  try {
    Airtable.configure({ apiKey });
    const base = Airtable.base(baseId);

    // Build a filter formula (optional filters)
    const parts = [];
    if (category) parts.push(`{Category} = "${category.replace(/"/g, '\\"')}"`);
    if (location) parts.push(`FIND(LOWER("${location.toLowerCase().replace(/"/g, '\\"')}"), LOWER({Location}))`);
    if (sku) parts.push(`FIND(LOWER("${sku.toLowerCase().replace(/"/g, '\\"')}"), LOWER({SKU}))`);
    if (Number.isFinite(maxPrice)) parts.push(`{Price} <= ${maxPrice}`);

    const filterByFormula = parts.length ? `AND(${parts.join(",")})` : undefined;

    const records = await base(tableName)
      .select({
        maxRecords: 200,
        sort: [{ field: "Created", direction: "desc" }],
        ...(filterByFormula ? { filterByFormula } : {}),
      })
      .all();

    const items = records.map((r) => ({
      id: r.id,
      createdAt: r.fields.Created || "",
      category: r.fields.Category || "",
      location: r.fields.Location || "",
      sku: r.fields.SKU || "",
      condition: r.fields.Condition || "",
      price: r.fields.Price || "",
      qty: r.fields.Qty || "",
      notes: r.fields.Notes || "",
    }));

    return json(200, { items });
  } catch (err) {
    return json(500, { error: "Airtable list failed", detail: String(err) });
  }
};
