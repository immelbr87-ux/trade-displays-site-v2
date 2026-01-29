const { json, requireAdmin, airtableQuery } = require("./_lib");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  const records = await airtableQuery({
    baseId,
    table: "Listings",
    apiKey,
    params: {}
  });

  const sellers = {};
  const gmvByDay = {};
  const pickupDelays = [];

  records.records.forEach(r => {
    const f = r.fields;
    const seller = f.seller_name || "Unknown";

    if (!sellers[seller]) sellers[seller] = { score: 100, sales: 0 };
    sellers[seller].sales++;

    // GMV trend
    if (f.paid_at) {
      const day = new Date(f.paid_at).toISOString().split("T")[0];
      gmvByDay[day] = (gmvByDay[day] || 0) + Number(f.price || 0);
    }

    // Pickup delay heatmap
    if (f.pickup_confirmed_at && f.paid_at) {
      const days = (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      pickupDelays.push(days);
      if (days > 3) sellers[seller].score -= 5;
      else sellers[seller].score += 1;
    }

    if (f.chargeback_flag) sellers[seller].score -= 25;
  });

  return json(200, {
    sellers,
    gmvByDay,
    pickupDelays
  });
};
