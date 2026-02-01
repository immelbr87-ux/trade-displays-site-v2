// netlify/functions/admin-get-commission-stats.js
const { json, requireAdmin, airtableQuery } = require("./_lib");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const records = await airtableQuery({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: "Listings",
    apiKey: process.env.AIRTABLE_API_KEY,
    params: {
      filterByFormula: "{commission_amount} > 0"
    }
  });

  let gmv = 0;
  let revenue = 0;
  const revenueByDay = {};

  for (const r of records.records) {
    const f = r.fields;
    const sale = Number(f.sale_price || 0);
    const fee = Number(f.commission_amount || 0);

    gmv += sale;
    revenue += fee;

    if (f.paid_at) {
      const day = new Date(f.paid_at).toISOString().split("T")[0];
      revenueByDay[day] = (revenueByDay[day] || 0) + fee;
    }
  }

  return json(200, {
    gmv,
    revenue,
    avg_take_rate: gmv ? revenue / gmv : 0,
    revenue_by_day: revenueByDay,
  });
};
