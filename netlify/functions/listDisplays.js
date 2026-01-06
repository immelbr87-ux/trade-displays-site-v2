// netlify/functions/listDisplays.js
const Airtable = require("airtable");

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

function pick(fields, names, fallback = "") {
  for (const n of names) {
    if (fields && fields[n] !== undefined && fields[n] !== null && fields[n] !== "") return fields[n];
  }
  return fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  // Support your old var name too, but prefer AIRTABLE_TOKEN
  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE || "Listings";
  const viewName = process.env.AIRTABLE_VIEW || "Public_Active";

  const q = event.queryStringParameters || {};
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize || "12", 10)));

  if (!token || !baseId) {
    return json(500, {
      error: "Missing Airtable env vars",
      needed: ["AIRTABLE_TOKEN (or AIRTABLE_API_KEY)", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE", "AIRTABLE_VIEW"],
      current: {
        AIRTABLE_TOKEN: Boolean(process.env.AIRTABLE_TOKEN),
        AIRTABLE_API_KEY: Boolean(process.env.AIRTABLE_API_KEY),
        AIRTABLE_BASE_ID: Boolean(process.env.AIRTABLE_BASE_ID),
        AIRTABLE_TABLE: process.env.AIRTABLE_TABLE || "",
        AIRTABLE_VIEW: process.env.AIRTABLE_VIEW || "",
      },
    });
  }

  try {
    Airtable.configure({ apiKey: token });
    const base = Airtable.base(baseId);

    // Pull records from the VIEW (this is the important part)
    const records = await base(tableName)
      .select({
        view: viewName,
        maxRecords: pageSize,
      })
      .all();

    const listings = records.map((r) => {
      const f = r.fields || {};

      // Map your Airtable fields to what market.html expects.
      // These "pick(...)" calls make it tolerant if your column names differ slightly.
      const title = pick(f, ["title", "Title", "listing_title", "Listing Title"], "Display Listing");
      const price = pick(f, ["price", "Price"], "");
      const condition_grade = pick(f, ["condition_grade", "Condition Grade", "grade", "Grade"], "");
      const category = pick(f, ["category", "Category"], "");
      const finish_family = pick(f, ["finish_family", "Finish Family", "finish", "Finish"], "");
      const dimensions = pick(f, ["dimensions", "Dimensions"], "");
      const key_spec = pick(f, ["key_spec", "Key Spec", "Rough-In / Key Spec", "rough_in_key_spec"], "");
      const pickup_window_start = pick(f, ["pickup_window_start", "Pickup Window Start"], "");
      const pickup_window_end = pick(f, ["pickup_window_end", "Pickup Window End"], "");
      const thumbnail_url = pick(f, ["thumbnail_url", "Thumbnail URL", "thumbnail", "Thumbnail"], "");

      return {
        id: r.id,
        title,
        price,
        condition_grade,
        category,
        finish_family,
        dimensions,
        key_spec,
        pickup_window_start,
        pickup_window_end,
        thumbnail_url,
      };
    });

    return json(200, { listings });
  } catch (err) {
    return json(500, {
      error: "Airtable fetch failed",
      detail: String(err && err.message ? err.message : err),
      hint:
        "Most common causes: wrong AIRTABLE_TABLE, wrong AIRTABLE_VIEW, token lacks base access, or the Airtable package not installed.",
    });
  }
};
