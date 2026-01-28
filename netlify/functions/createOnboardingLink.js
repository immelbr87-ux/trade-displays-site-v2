const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { stripe_account_id } = JSON.parse(event.body || "{}");

    if (!stripe_account_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing stripe_account_id" }) };
    }

    // These URLs must exist on your site (can be simple pages)
    const refresh_url = "https://showroommarket.com/onboarding-refresh.html";
    const return_url = "https://showroommarket.com/onboarding-return.html";

    const link = await stripe.accountLinks.create({
      account: stripe_account_id,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: link.url }),
    };
  } catch (err) {
    console.error("createOnboardingLink error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
