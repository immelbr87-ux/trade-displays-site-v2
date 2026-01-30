// Centralized environment config

console.log("Loading config...");

module.exports = {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  adminSecret: process.env.ADMIN_SECRET_TOKEN,

  siteUrl: process.env.SITE_URL,

  mailerSendApiKey: process.env.MAILERSEND_API_KEY,
  fromEmail: process.env.MAILERSEND_FROM_EMAIL,
  fromName: process.env.MAILERSEND_FROM_NAME,

  airtableApiKey: process.env.AIRTABLE_API_KEY,
  airtableBaseId: process.env.AIRTABLE_BASE_ID,
  airtableTable: process.env.AIRTABLE_TABLE,
  airtableView: process.env.AIRTABLE_VIEW,
};
