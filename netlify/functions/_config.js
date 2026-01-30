module.exports = {
  stripeSecret: process.env.STRIPE_SECRET_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  baseUrl: process.env.URL // Netlify provides this
};
