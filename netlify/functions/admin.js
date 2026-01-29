const fetch = require("node-fetch");
const { json, requireAdmin } = require("./_lib");

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY;
const LISTINGS = "Listings";

/* ===============================
   🔄 Fetch ALL Airtable Records
   =============================== */
async function fetchAllListings() {
  let all = [];
  let offset = null;

  do {
    const url = `https://api.airtable.com/v0/${baseId}/${LISTINGS}${
      offset ? `?offset=${offset}` : ""
    }`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await res.json();
    all = all.concat(data.records);
    offset = data.offset;
  } while (offset);

  return all;
}

/* ===============================
   🧠 Dashboard Logic
   =============================== */
exports.handler = async (event) => {
  if (!requireAdmin(event).ok) {
    return json(401, { error: "Unauthorized" });
  }

  try {
    const records = await fetchAllListings();

    const sellers = {};
    const gmvByDay = {};
    const pickupDelays = [];
    const geoCounts = {};
    const disputesByDay = {};
    const riskListings = [];
    const slaBreaches = [];

    records.forEach((r) => {
      const f = r.fields || {};
      const seller = f.seller_name || "Unknown Seller";
      const price = Number(f.price || 0);

      if (!sellers[seller]) {
        sellers[seller] = {
          sales: 0,
          gmv: 0,
          pickupDays: [],
          latePickups: 0,
          disputes: 0,
        };
      }

      sellers[seller].sales++;
      sellers[seller].gmv += price;

      // GMV Trend
      if (f.paid_at) {
        const day = new Date(f.paid_at).toISOString().split("T")[0];
        gmvByDay[day] = (gmvByDay[day] || 0) + price;
      }

      // Pickup Delay + SLA Breach
      if (f.paid_at && !f.pickup_confirmed_at) {
        const daysSincePaid =
          (Date.now() - new Date(f.paid_at)) / 86400000;

        if (daysSincePaid > 4) {
          slaBreaches.push({
            listing: f.title || r.id,
            seller,
            daysOpen: Math.floor(daysSincePaid),
          });
        }
      }

      if (f.paid_at && f.pickup_confirmed_at) {
        const days =
          (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) /
          86400000;
        pickupDelays.push(days);
        sellers[seller].pickupDays.push(days);
        if (days > 3) sellers[seller].latePickups++;
      }

      // Geo Analytics
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

      // Listing Risk
      let risk = 0;
      if (price > 2000) risk += 2;
      if (f.chargeback_flag) risk += 5;
      if (f.paid_at && !f.pickup_confirmed_at) risk += 2;

      if (risk >= 4) {
        riskListings.push({
          listing: f.title || r.id,
          seller,
          riskScore: risk,
        });
      }
    });

    /* ===============================
       🧾 Seller Report Cards
       =============================== */
    const sellerCards = Object.entries(sellers).map(([name, s]) => {
      const avgPickup =
        s.pickupDays.length > 0
          ? s.pickupDays.reduce((a, b) => a + b, 0) /
            s.pickupDays.length
          : 0;

      let score = 100;
      score -= s.latePickups * 5;
      score -= s.disputes * 25;
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
        avgPickupDays: Number(avgPickup.toFixed(1)),
        latePickups: s.latePickups,
        disputes: s.disputes,
      };
    });

    /* ===============================
       📈 GMV Forecast (Simple Linear)
       =============================== */
    const daysCount = Object.keys(gmvByDay).length || 1;
    const dailyAvg =
      Object.values(gmvByDay).reduce((a, b) => a + b, 0) / daysCount;

    const forecast = {
      d30: Math.round(dailyAvg * 30),
      d60: Math.round(dailyAvg * 60),
      d90: Math.round(dailyAvg * 90),
    };

    return json(200, {
      sellerCards,
      gmvByDay,
      pickupDelays,
      geoCounts,
      disputesByDay,
      riskListings,
      slaBreaches,
      forecast,
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    return json(500, { error: "Dashboard load failed" });
  }
};
