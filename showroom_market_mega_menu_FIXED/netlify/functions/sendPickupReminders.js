const { sendEmail } = require("./_email");
const { airtableQuery } = require("./_lib");

exports.handler = async () => {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  const records = await airtableQuery({
    baseId,
    table: "Orders",
    apiKey,
    params: {
      filterByFormula: `AND({Status}='Paid – Pending Pickup', IS_BEFORE({pickup_date}, DATEADD(NOW(), 1, 'days')))`,
    },
  });

  for (const r of records.records) {
    const email = r.fields.buyer_email;
    const product = r.fields.product_name;

    await sendEmail({
      to: email,
      subject: "Reminder: Pickup Your Item",
      html: `<p>This is a reminder to pick up <b>${product}</b>.</p>`,
    });
  }

  return { statusCode: 200, body: "Reminders sent" };
};
