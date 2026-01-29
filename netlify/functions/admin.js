const Stripe = require("stripe");
const fetch = require("node-fetch");
const {
  json,
  requireAdmin
} = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY;
const table = "Listings";

exports.handler = async (event) => {
  if (!requireAdmin(event).ok) {
    return json(401, { error: "Unauthorized" });
  }

  const body = JSON.parse(event.body || "{}");
  const action = body.action || "get_dashboard";

  // Fetch all listings once
  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${table}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  const records = (await res.json()).records || [];

  if (action !== "get_dashboard") {
    return json(400, { error: "Unknown action" });
  }

  const sellers = {};
  const gmvByDay = {};
  const pickupDelays = [];
  const geoCounts = {};
  const disputesByDay = [];
  const riskListings = [];

  records.forEach(r => {
    const f = r.fields || {};
    const seller = f.seller_name || "Unknown Seller";
    const price = Number(f.price || 0);

    if (!sellers[seller]) {
      sellers[seller] = {
        sales: 0,
        gmv: 0,
        pickupDays: [],
        latePickups: 0,
        disputes: 0
      };
    }

    sellers[seller].sales++;
    sellers[seller].gmv += price;

    // GMV trend
    if (f.paid_at) {
      const day = new Date(f.paid_at).toISOString().split("T")[0];
      gmvByDay[day] = (gmvByDay[day] || 0) + price;
    }

    // Pickup delay
    if (f.paid_at && f.pickup_confirmed_at) {
      const days =
        (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      pickupDelays.push(days);
      sellers[seller].pickupDays.push(days);
      if (days > 3) sellers[seller].latePickups++;
    }

    // Geo
    if (f.pickup_city) {
      geoCounts[f.pickup_city] =
        (geoCounts[f.pickup_city] || 0) + 1;
    }

    // Disputes
    if (f.chargeback_flag) {
      sellers[seller].disputes++;
      if (f.paid_at) {
        disputesByDay.push(
          new Date(f.paid_at).toISOString().split("T")[0]
        );
      }
    }

    // Listing risk
    let risk = 0;
    if (price > 2000) risk += 2;
    if (f.chargeback_flag) risk += 5;
    if (f.paid_at && !f.pickup_confirmed) risk += 2;

    if (risk >= 4) {
      riskListings.push({
        listing: f.title || r.id,
        seller,
        risk
      });
    }
  });

  // Build seller report cards
  const sellerCards = Object.entries(sellers).map(([name, s]) => {
    const avgPickup =
      s.pickupDays.length
        ? (s.pickupDays.reduce((a, b) => a + b, 0) / s.pickupDays.length)
        : 0;

    let score = 100;
    score -= s.latePickups * 5;
    score -= s.disputes * 25;
    score = Math.max(0, score);

    let tier = "Low";
    if (score < 70) tier = "Medium";
    if (score < 40) tier = "High";

    return {
      seller: name,
      sales: s.sales,
      gmv: Math.round(s.gmv),
      avgPickupDays: Number(avgPickup.toFixed(1)),
      latePickups: s.latePickups,
      disputes: s.disputes,
      score,
      riskTier: tier
    };
  });

  return json(200, {
    sellerCards,
    gmvByDay,
    pickupDelays,
    geoCounts,
    disputesByDay,
    riskListings
  });
};
