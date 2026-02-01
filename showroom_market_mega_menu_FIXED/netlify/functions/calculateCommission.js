// netlify/functions/calculateCommission.js
// Tiered commission logic for Showroom Market with minimum platform fee

function calculateCommission(salePrice) {
  let rate;

  if (salePrice < 800) {
    rate = 0.15;
  } else if (salePrice <= 2000) {
    rate = 0.12;
  } else {
    rate = 0.10;
  }

  let commissionAmount = salePrice * rate;

  // Minimum platform fee floor
  // Minimum platform fee floor (requested)
  const MIN_PLATFORM_FEE = 99;
  if (commissionAmount < MIN_PLATFORM_FEE) {
    commissionAmount = MIN_PLATFORM_FEE;
  }

  const sellerPayout = salePrice - commissionAmount;

  return {
    commission_rate: rate,
    commission_amount: +commissionAmount.toFixed(2),
    seller_payout_amount: +sellerPayout.toFixed(2),
  };
}

module.exports = calculateCommission;
