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
    const url = `https://api.airtable.com/v0/${baseId}/${LISTINGS}${offset ? `?offset=${offset}` : ""}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Airtable fetch failed:", res.status, data);
      throw new Error(`Airtable fetch failed (${res.status})`);
    }

    all = all.concat(data.records || []);
    offset = data.offset;
  } while (offset);

  return all;
}

function isoDay(d) {
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return null;
  }
}

/* ===============================
   🧠 Dashboard Logic
   =============================== */
exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) {
    return json(401, { error: "Unauthorized" });
  }

  try {
    const records = await fetchAllListings();

    const sellers = {};
    const gmvByDay = {};
    const pickupDelays = [];
    const geoCounts = {};
    const disputesByDay = {}; // { YYYY-MM-DD: count }
    const disputes = [];      // list of dispute/chargeback flagged listings
    const riskListings = [];
    const slaBreaches = [];

    records.forEach((r) => {
      const f = r.fields || {};
      const seller = f.seller_name || f.showroom_name || "Unknown Seller";
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

      // Treat a "sale" as a paid item (paid_at exists OR status indicates paid)
      const isPaid = Boolean(f.paid_at) || String(f.status || "").toLowerCase().includes("paid");
      if (isPaid) {
        sellers[seller].sales++;
        sellers[seller].gmv += price;
      }

      // GMV Trend (paid date)
      if (f.paid_at) {
        const day = isoDay(f.paid_at);
        if (day) gmvByDay[day] = (gmvByDay[day] || 0) + price;
      }

      // Pickup Delay + SLA Breach (paid but not picked up)
      if (f.paid_at && !f.pickup_confirmed_at) {
        const daysSincePaid = (Date.now() - new Date(f.paid_at)) / 86400000;

        if (daysSincePaid > 4) {
          slaBreaches.push({
            listing: f.title || r.id,
            listingId: r.id,
            seller,
            daysOpen: Math.floor(daysSincePaid),
          });
        }
      }

      // Pickup delays (paid + picked up)
      if (f.paid_at && f.pickup_confirmed_at) {
        const days = (new Date(f.pickup_confirmed_at) - new Date(f.paid_at)) / 86400000;
        pickupDelays.push(days);
        sellers[seller].pickupDays.push(days);
        if (days > 3) sellers[seller].latePickups++;
      }

      // Geo Analytics
      if (f.pickup_city) {
        geoCounts[f.pickup_city] = (geoCounts[f.pickup_city] || 0) + 1;
      }

      // Disputes / Chargebacks
      if (f.chargeback_flag) {
        sellers[seller].disputes++;

        const day = isoDay(f.paid_at || f.updated_at || f.created_at || Date.now());
        if (day) disputesByDay[day] = (disputesByDay[day] || 0) + 1;

        disputes.push({
          listing: f.title || r.id,
          listingId: r.id,
          seller,
          price: price,
          status: f.status || "",
          paid_at: f.paid_at || null,
          pickup_confirmed_at: f.pickup_confirmed_at || null,
          stripe_session_id: f.stripe_session_id || null,
          stripe_payment_intent: f.stripe_payment_intent || null,
          notes: f.chargeback_notes || f.dispute_notes || null,
        });
      }

      // Listing Risk
      let risk = 0;
      if (price > 2000) risk += 2;
      if (f.chargeback_flag) risk += 5;
      if (f.paid_at && !f.pickup_confirmed_at) risk += 2;

      if (risk >= 4) {
        riskListings.push({
          listing: f.title || r.id,
          listingId: r.id,
          seller,
          riskScore: risk,
          status: f.status || "",
          price,
        });
      }
    });

    /* ===============================
       🧾 Seller Report Cards
       =============================== */
    const sellerCards = Object.entries(sellers).map(([name, s]) => {
      const avgPickup =
        s.pickupDays.length > 0 ? s.pickupDays.reduce((a, b) => a + b, 0) / s.pickupDays.length : 0;

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
    const dailyAvg = Object.values(gmvByDay).reduce((a, b) => a + b, 0) / daysCount;

    const forecast = {
      d30: Math.round(dailyAvg * 30),
      d60: Math.round(dailyAvg * 60),
      d90: Math.round(dailyAvg * 90),
    };

    // Dispute summary
    const disputeSummary = {
      total: disputes.length,
      open: disputes.filter((d) => String(d.status || "").toLowerCase().includes("dispute") || String(d.status || "").toLowerCase().includes("chargeback")).length,
    };

    return json(200, {
      sellerCards,
      gmvByDay,
      pickupDelays,
      geoCounts,
      disputesByDay,
      disputes,
      disputeSummary,
      riskListings,
      slaBreaches,
      forecast,
    });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    return json(500, { error: "Dashboard load failed" });
  }
};
