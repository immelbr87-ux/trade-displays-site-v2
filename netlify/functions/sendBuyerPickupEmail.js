const fetch = require("node-fetch");

exports.handler = async () => {
  console.log("Running payout release job");

  const nowISO = new Date().toISOString();

  const res = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings?filterByFormula=AND({seller_payout_status}='Pending',{payout_eligible_at}<'${nowISO}')`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
  );

  const records = (await res.json()).records;

  for (const record of records) {
    console.log("Marking payout ready:", record.id);

    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${record.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: { seller_payout_status: "Ready for Payout" }
        }),
      }
    );
  }

  return { statusCode: 200 };
};
