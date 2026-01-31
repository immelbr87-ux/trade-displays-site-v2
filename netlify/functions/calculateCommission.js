// netlify/functions/calculateCommission.js
// Commission utility for Showroom Market
// - Reads PLATFORM_FEE_PERCENT or PLATFORM_FEE_BPS from env
// - Computes platform fee and seller payout in dollars & cents-safe integers

function getCommissionConfig() {
  const percentRaw = process.env.PLATFORM_FEE_PERCENT;
  const bpsRaw = process.env.PLATFORM_FEE_BPS;

  let percent = null;

  if (bpsRaw != null && String(bpsRaw).trim() !== "") {
    const bps = Number(bpsRaw);
    if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
      throw new Error("Invalid PLATFORM_FEE_BPS (0-10000)");
    }
    percent = bps / 100;
  } else if (percentRaw != null && String(percentRaw).trim() !== "") {
    const p = Number(percentRaw);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new Error("Invalid PLATFORM_FEE_PERCENT (0-100)");
    }
    percent = p;
  } else {
    // Default is intentionally conservative; override with env vars.
    percent = 10;
  }

  // Optional minimum fee (in cents)
  const minFeeCentsRaw = process.env.PLATFORM_FEE_MIN_CENTS;
  const minFeeCents =
    minFeeCentsRaw != null && String(minFeeCentsRaw).trim() !== ""
      ? Math.max(0, Math.floor(Number(minFeeCentsRaw)))
      : 0;

  return { percent, minFeeCents };
}

function toCents(amountDollars) {
  const n = Number(amountDollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function computeCommissionFromCents(grossCents) {
  const { percent, minFeeCents } = getCommissionConfig();

  if (!Number.isFinite(grossCents) || grossCents < 0) {
    throw new Error("Invalid grossCents");
  }

  // Fee = gross * percent, rounded to nearest cent
  let feeCents = Math.round((grossCents * percent) / 100);

  if (feeCents < minFeeCents) feeCents = minFeeCents;
  if (feeCents > grossCents) feeCents = grossCents;

  const payoutCents = grossCents - feeCents;

  return {
    percent,
    feeCents,
    payoutCents,
    feeDollars: feeCents / 100,
    payoutDollars: payoutCents / 100,
    grossDollars: grossCents / 100,
  };
}

module.exports = {
  getCommissionConfig,
  toCents,
  computeCommissionFromCents,
};
