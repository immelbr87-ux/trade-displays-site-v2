// netlify/functions/calculateCommission.js
// Computes platform fee + seller payout for a given sale amount.
// Defaults can be overridden via env vars:
//   PLATFORM_FEE_PCT (e.g. 0.15 for 15%)
//   PLATFORM_FEE_FLAT (e.g. 50 for $50 flat fee)
//   PLATFORM_FEE_MIN / PLATFORM_FEE_MAX (optional caps)

function num(v, d=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, lo, hi) {
  if (Number.isFinite(lo)) n = Math.max(lo, n);
  if (Number.isFinite(hi)) n = Math.min(hi, n);
  return n;
}

function calculateCommission(amountUsd, overrides = {}) {
  const amount = num(amountUsd, 0);
  if (amount <= 0) {
    return {
      ok: false,
      reason: "Invalid amount",
      sale_amount: amount,
      platform_fee: 0,
      seller_payout: 0,
      effective_pct: 0
    };
  }

  const pct = overrides.pct ?? process.env.PLATFORM_FEE_PCT;
  const flat = overrides.flat ?? process.env.PLATFORM_FEE_FLAT;
  const minFee = overrides.minFee ?? process.env.PLATFORM_FEE_MIN;
  const maxFee = overrides.maxFee ?? process.env.PLATFORM_FEE_MAX;

  const pctNum = num(pct, 0.15);     // default 15%
  const flatNum = num(flat, 0);      // default $0
  const minNum = (minFee === undefined || minFee === null || minFee === "") ? null : num(minFee, 0);
  const maxNum = (maxFee === undefined || maxFee === null || maxFee === "") ? null : num(maxFee, 0);

  let fee = amount * pctNum + flatNum;
  fee = Math.round(fee * 100) / 100;

  if (minNum !== null || maxNum !== null) {
    fee = clamp(fee, minNum, maxNum);
    fee = Math.round(fee * 100) / 100;
  }

  // Never allow fee > sale
  fee = Math.min(fee, amount);

  const seller = Math.round((amount - fee) * 100) / 100;
  const effPct = amount > 0 ? Math.round((fee / amount) * 10000) / 10000 : 0;

  return {
    ok: true,
    sale_amount: amount,
    platform_fee: fee,
    seller_payout: seller,
    effective_pct: effPct
  };
}

module.exports = { calculateCommission };
