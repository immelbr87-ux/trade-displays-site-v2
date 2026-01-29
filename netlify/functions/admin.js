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
  const geoCounts = {};
  const disputesByDay = {};
  const riskyListings = [];

  records.records.forEach(r => {
    const f = r.fields;
    const seller = f.seller_name || "Unknown";

    if (!sellers[seller]) sellers[seller] = { score: 100, sales: 0 };
    sellers[seller].sales++;

    // GMV Trend
    if (f.paid_at) {
      const day = new Date(f.paid_at).toISOString().split("T")[0];
      gmvByDay[day] = (gmvByDay[day] || 0) + Number(f.price || 0);
    }

    // Pickup Delay
    if (f.pickup_confirmed_at && f.paid_at) {
      const days = (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      pickupDelays.push(days);
      if (days > 3) sellers[seller].score -= 5;
      else sellers[seller].score += 1;
    }

    // Geo Analytics
    if (f.pickup_city) {
      geoCounts[f.pickup_city] = (geoCounts[f.pickup_city] || 0) + 1;
    }

    // Disputes
    if (f.chargeback_flag && f.paid_at) {
      const day = new Date(f.paid_at).toISOString().split("T")[0];
      disputesByDay[day] = (disputesByDay[day] || 0) + 1;
      sellers[seller].score -= 25;
    }

    // Risk Scoring
    let riskScore = 0;
    if (Number(f.price) > 2000) riskScore += 2;
    if (f.chargeback_flag) riskScore += 5;
    if (f.pickup_confirmed_at && f.paid_at) {
      const days = (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      if (days > 5) riskScore += 2;
    }

    if (riskScore >= 4) {
      riskyListings.push({
        listing: f.title || r.id,
        seller,
        riskScore
      });
    }
  });

  return json(200, {
    sellers,
    gmvByDay,
    pickupDelays,
    geoCounts,
    disputesByDay,
    riskyListings
  });
};
