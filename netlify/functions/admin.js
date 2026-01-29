const fetch = require("node-fetch");
const { json, requireAdmin } = require("./_lib");

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY;

const LISTINGS = "Listings";
const AUDIT = "Audit Log";

async function logAudit(action, recordId, actor, details = "") {
  await fetch(`https://api.airtable.com/v0/${baseId}/${AUDIT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: {
        action,
        record_id: recordId,
        actor,
        timestamp: new Date().toISOString(),
        details
      }
    })
  });
}

exports.handler = async (event) => {
  if (!requireAdmin(event).ok) {
    return json(401, { error: "Unauthorized" });
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${baseId}/${LISTINGS}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  const records = (await res.json()).records || [];

  const sellers = {};
  const gmvByDay = {};
  const slaBreaches = [];
  const lockedListings = [];

  records.forEach(r => {
    const f = r.fields || {};
    const seller = f.seller_name || "Unknown";
    const price = Number(f.price || 0);

    if (!sellers[seller]) {
      sellers[seller] = {
        sales: 0,
        gmv: 0,
        pickupDays: [],
        late: 0,
        disputes: 0
      };
    }

    sellers[seller].sales++;
    sellers[seller].gmv += price;

    // GMV trend
    if (f.paid_at) {
      const d = new Date(f.paid_at).toISOString().split("T")[0];
      gmvByDay[d] = (gmvByDay[d] || 0) + price;
    }

    // Pickup SLA
    if (f.paid_at && !f.pickup_confirmed_at) {
      const days = (Date.now() - new Date(f.paid_at)) / 86400000;
      if (days > 4) {
        slaBreaches.push({
          listing: f.title || r.id,
          seller,
          days: Math.floor(days)
        });
      }
    }

    // Pickup delay scoring
    if (f.paid_at && f.pickup_confirmed_at) {
      const days =
        (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
      sellers[seller].pickupDays.push(days);
      if (days > 3) sellers[seller].late++;
    }

    if (f.chargeback_flag) sellers[seller].disputes++;

    // Auto-lock Watchlist sellers
    if (f.seller_badge === "Watchlist" && !f.locked) {
      lockedListings.push({ id: r.id, seller });
    }
  });

  // Lock risky listings + audit
  for (const l of lockedListings) {
    await fetch(
      `https://api.airtable.com/v0/${baseId}/${LISTINGS}/${l.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: { locked: true } })
      }
    );
    await logAudit("AUTO_LOCK", l.id, "system", "Watchlist seller");
  }

  // Seller report cards
  const sellerCards = Object.entries(sellers).map(([name, s]) => {
    const avgPickup =
      s.pickupDays.length
        ? s.pickupDays.reduce((a, b) => a + b, 0) / s.pickupDays.length
        : 0;

    let score = 100 - s.late * 5 - s.disputes * 25;
    score = Math.max(0, score);

    let badge = "Gold";
    if (score < 85) badge = "Silver";
    if (score < 60) badge = "Watchlist";

    return {
      seller: name,
      badge,
      score,
      sales: s.sales,
      gmv: Math.round(s.gmv),
      avgPickupDays: avgPickup.toFixed(1)
    };
  });

  // GMV Forecast
  const dailyAvg =
    Object.values(gmvByDay).reduce((a, b) => a + b, 0) /
    Math.max(Object.keys(gmvByDay).length, 1);

  const forecast = {
    d30: Math.round(dailyAvg * 30),
    d60: Math.round(dailyAvg * 60),
    d90: Math.round(dailyAvg * 90)
  };

  return json(200, {
    sellerCards,
    gmvByDay,
    forecast,
    slaBreaches
  });
};
