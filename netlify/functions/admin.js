// SHOWROOM MARKET OPS OS

const Stripe = require("stripe");
const crypto = require("crypto");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
const table = process.env.AIRTABLE_TABLE || "Listings";
const logsTable = "Pickup_Logs";

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function requireAdmin(event) {
  const auth = event.headers.authorization || "";
  return auth === `Bearer ${process.env.ADMIN_SECRET_TOKEN}`;
}

async function airtableList(tableName) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return (await r.json()).records || [];
}

exports.handler = async (event) => {
  if (!requireAdmin(event)) return json(401, { error: "Unauthorized" });
  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  try {

    if (action === "get_metrics") {
      const listings = await airtableList(table);
      const logs = await airtableList(logsTable);

      const today = new Date(); today.setHours(0,0,0,0);
      const week = new Date(); week.setDate(today.getDate()-7);

      let metrics = {
        gmv:0, fees:0, payouts_sent:0, payouts_pending:0,
        today_pickups:0, week_pickups:0,
        fraud_attempts:0, pickup_failures:0,
        avg_pickup_days:0, sellers:{}
      };

      listings.forEach(r=>{
        const f=r.fields||{};
        const price=Number(f.price||0);
        const payout=Number(f.seller_payout_amount||0);

        metrics.gmv+=price;
        metrics.fees+=(price-payout);

        if(f.payout_sent_at) metrics.payouts_sent+=payout;
        else if(f.pickup_confirmed) metrics.payouts_pending+=payout;

        if(f.pickup_confirmed_at){
          const d=new Date(f.pickup_confirmed_at);
          if(d>=today) metrics.today_pickups++;
          if(d>=week) metrics.week_pickups++;
        }

        if(f.paid_at && f.pickup_confirmed_at){
          const lag=(new Date(f.pickup_confirmed_at)-new Date(f.paid_at))/86400000;
          metrics.avg_pickup_days+=lag;
        }

        const seller=f.seller_name||"Unknown";
        if(!metrics.sellers[seller]) metrics.sellers[seller]={sales:0,failures:0};
        metrics.sellers[seller].sales++;
      });

      logs.forEach(r=>{
        const f=r.fields||{};
        if(f.scan_result!=="success") metrics.fraud_attempts++;
        if(f.scan_result==="fail") metrics.pickup_failures++;
      });

      metrics.avg_pickup_days = metrics.today_pickups ? (metrics.avg_pickup_days/metrics.today_pickups).toFixed(1) : 0;

      return json(200,{ok:true,metrics});
    }

    return json(400,{error:"Unknown action"});

  } catch(e){
    console.error(e);
    return json(500,{error:e.message});
  }
};
