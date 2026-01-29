const {
  json,
  requireAdmin,
  airtableQuery
} = require("./_lib");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const { action } = JSON.parse(event.body || "{}");

  if (action !== "get_metrics") return json(400, { error: "Unknown action" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  const data = await airtableQuery({
    baseId,
    table: "Listings",
    apiKey,
    params: {}
  });

  let sellers = {};
  let latePickups = 0;
  let totalPickups = 0;
  let pickupDaysSum = 0;

  data.records.forEach(r => {
    const f = r.fields;
    const seller = f.seller_name || "Unknown";

    if (!sellers[seller]) sellers[seller] = { score: 100, sales: 0 };

    sellers[seller].sales++;

    if (f.pickup_confirmed_at && f.paid_at) {
      const days = (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      pickupDaysSum += days;
      totalPickups++;

      if (days > 3) {
        latePickups++;
        sellers[seller].score -= 5;
      } else {
        sellers[seller].score += 1;
      }
    }

    if (f.chargeback_flag) sellers[seller].score -= 25;
  });

  const avgPickupDays = totalPickups ? (pickupDaysSum / totalPickups).toFixed(1) : 0;

  return json(200, {
    avgPickupDays,
    latePickupRate: totalPickups ? ((latePickups / totalPickups) * 100).toFixed(1) + "%" : "0%",
    sellers
  });
};
