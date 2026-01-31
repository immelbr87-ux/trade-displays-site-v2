// netlify/functions/calculateCommission.js
// Tiered commission logic for Showroom Market

function calculateCommission(salePrice) {
  let rate;

  if (salePrice < 800) {
    rate = 0.15;
  } else if (salePrice <= 2000) {
    rate = 0.12;
  } else {
    rate = 0.10;
  }

  const commissionAmount = +(salePrice * rate).toFixed(2);
  const sellerPayout = +(salePrice - commissionAmount).toFixed(2);

  return {
    commission_rate: rate,
    commission_amount: commissionAmount,
    seller_payout_amount: sellerPayout,
  };
}

module.exports = calculateCommission;