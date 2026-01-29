const Stripe = require("stripe");
const crypto = require("crypto");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
const table = process.env.AIRTABLE_TABLE || "Listings";
const logsTable = "Pickup_Logs";

const ALERT_EMAIL = process.env.ALERT_EMAIL; // your email for fraud alerts
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function requireAdmin(event) {
  const auth = event.headers.authorization || "";
  return auth === `Bearer ${process.env.ADMIN_SECRET_TOKEN}`;
}

async function sendFraudAlert(subject, message) {
  if (!MAILERSEND_API_KEY || !ALERT_EMAIL) return;

  await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAILERSEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: { email: "alerts@showroommarket.com", name: "Showroom Market Alerts" },
      to: [{ email: ALERT_EMAIL }],
      subject,
      text: message
    })
  });
}

async function airtableGet(recordId) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${table}/${recordId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return await r.json();
}

async function airtablePatch(recordId, fields) {
  await fetch(`https://api.airtable.com/v0/${baseId}/${table}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
}

exports.handler = async (event) => {
  if (!requireAdmin(event)) return json(401, { error: "Unauthorized" });
  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  try {

    // 📱 MOBILE PICKUP + FRAUD PROTECTION
    if (action === "verify_pickup_and_payout") {
      const [prefix, recordId, token] = (body.payload || "").split("|");

      if (!recordId || !token) {
        await sendFraudAlert("Invalid QR Scan", `Payload received: ${body.payload}`);
        return json(400, { error: "Invalid QR format" });
      }

      const rec = await airtableGet(recordId);
      const f = rec.fields || {};

      if (f.pickup_qr_used) {
        await sendFraudAlert("Duplicate QR Scan", `Listing ${recordId}`);
        return json(409, { error: "QR already used" });
      }

      if (f.pickup_qr_token !== token) {
        await sendFraudAlert("QR Token Mismatch", `Listing ${recordId}`);
        return json(401, { error: "Token mismatch" });
      }

      if (!String(f.status || "").toLowerCase().includes("paid")) {
        await sendFraudAlert("Pickup Attempt Before Payment", `Listing ${recordId}`);
        return json(409, { error: "Not paid" });
      }

      await airtablePatch(recordId, {
        pickup_qr_used: true,
        pickup_confirmed: true,
        pickup_confirmed_at: new Date().toISOString(),
        status: "Picked Up"
      });

      const updated = await airtableGet(recordId);
      const amount = Math.round((updated.fields.seller_payout_amount || 0) * 100);
      const acct = updated.fields.stripe_account_id;

      if (acct && amount > 0 && !updated.fields.stripe_transfer_id) {
        try {
          const transfer = await stripe.transfers.create({
            amount,
            currency: "usd",
            destination: acct,
            metadata: { listingId: recordId }
          });

          await airtablePatch(recordId, {
            stripe_transfer_id: transfer.id,
            payout_sent_at: new Date().toISOString(),
            seller_payout_status: "Paid"
          });
        } catch (err) {
          await sendFraudAlert("Stripe Payout Failed", `Listing ${recordId}\n${err.message}`);
        }
      }

      return json(200, { ok: true, listingId: recordId });
    }

    // 📊 METRICS (unchanged)
    if (action === "get_metrics") {
      const listingsRes = await fetch(`https://api.airtable.com/v0/${baseId}/${table}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const listings = (await listingsRes.json()).records || [];

      let metrics = { gmv:0, fees:0, payouts_sent:0, payouts_pending:0 };

      listings.forEach(r=>{
        const f=r.fields||{};
        const price=Number(f.price||0);
        const payout=Number(f.seller_payout_amount||0);
        metrics.gmv+=price;
        metrics.fees+=(price-payout);
        if(f.payout_sent_at) metrics.payouts_sent+=payout;
        else if(f.pickup_confirmed) metrics.payouts_pending+=payout;
      });

      return json(200,{ok:true,metrics});
    }

    return json(400,{error:"Unknown action"});

  } catch(e){
    await sendFraudAlert("Admin Function Error", e.message);
    return json(500,{error:e.message});
  }
};
