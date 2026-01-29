// netlify/functions/admin.js
// One admin router for:
// - get_listing
// - verify_pickup_and_payout
// - get_payout_history
// - retry_payout
// - start_onboarding (Stripe Connect account link)

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const {
  json,
  requireAdmin,
  airtableGetRecord,
  airtablePatchRecord,
  airtableQuery,
  pick,
} = require("./_lib");

function parsePayload(payload) {
  // SMK|recXXXXXXXXXXXXXX|token
  if (!payload || typeof payload !== "string") return null;
  const trimmed = payload.trim();
  const decoded = (() => { try { return decodeURIComponent(trimmed); } catch { return trimmed; } })();
  const parts = decoded.split("|");
  if (parts.length !== 3) return null;
  const [prefix, recordId, token] = parts;
  if (prefix !== "SMK") return null;
  if (!recordId || !recordId.startsWith("rec")) return null;
  if (!token || token.length < 8) return null;
  return { recordId, token, decoded };
}

async function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed (POST)" });

  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  if (!baseId || !apiKey) return json(500, { error: "Missing Airtable env vars" });

  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY" });

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch { return json(400, { error: "Invalid JSON" }); }

  const action = String(body.action || "").trim();

  try {
    // =========================
    // 1) GET LISTING
    // =========================
    if (action === "get_listing") {
      const recordId = String(body.recordId || "").trim();
      if (!recordId.startsWith("rec")) return json(400, { error: "Invalid recordId" });
      const rec = await airtableGetRecord({ baseId, table, recordId, apiKey });
      return json(200, { ok: true, record: rec });
    }

    // =========================
    // 2) PICKUP SCAN + PAY NOW
    // =========================
    if (action === "verify_pickup_and_payout") {
      const parsed = parsePayload(body.payload);
      if (!parsed) return json(400, { error: "Invalid QR payload", expected: "SMK|rec...|token" });

      const { recordId, token: scannedToken, decoded } = parsed;

      const rec = await airtableGetRecord({ baseId, table, recordId, apiKey });
      const f = rec.fields || {};

      // token match
      const expectedToken = f.pickup_qr_token ? String(f.pickup_qr_token).trim() : "";
      const expectedPayload = f.pickup_qr_payload ? String(f.pickup_qr_payload).trim() : "";
      const tokenOk =
        (expectedToken && expectedToken === scannedToken) ||
        (expectedPayload && expectedPayload === decoded);
      if (!tokenOk) return json(401, { error: "QR token mismatch", recordId });

      // must be paid-like
      const status = String(f.status || "");
      const isPaidLike =
        status.toLowerCase().includes("paid") ||
        status.toLowerCase().includes("pending pickup");
      if (!isPaidLike) return json(409, { error: "Not in a paid state", recordId, status });

      // If already picked up, just return state (no payout duplication)
      if (f.pickup_confirmed === true) {
        return json(200, {
          ok: true,
          message: "Already picked up (no changes).",
          recordId,
          pickup_confirmed_at: f.pickup_confirmed_at || null,
          seller_payout_status: f.seller_payout_status || null,
          stripe_transfer_id: f.stripe_transfer_id || null,
        });
      }

      // mark pickup first
      const nowIso = new Date().toISOString();
      await airtablePatchRecord({
        baseId, table, recordId, apiKey,
        fields: { pickup_confirmed: true, pickup_confirmed_at: nowIso, status: "Picked Up" },
      });

      // reload for payout fields
      const rec2 = await airtableGetRecord({ baseId, table, recordId, apiKey });
      const g = rec2.fields || {};

      const alreadyPaid =
        String(g.seller_payout_status || "").toLowerCase() === "paid" ||
        !!g.stripe_transfer_id;

      if (alreadyPaid) {
        return json(200, {
          ok: true,
          message: "Pickup confirmed. Payout already sent (duplicate protection).",
          recordId,
          payout_attempted: false,
          seller_payout_status: g.seller_payout_status || null,
          stripe_transfer_id: g.stripe_transfer_id || null,
        });
      }

      const destination = String(g.stripe_account_id || "").trim();
      const payoutAmount = Number(g.seller_payout_amount);

      if (!destination) {
        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: { seller_payout_status: "Failed", payout_error: "Missing stripe_account_id." },
        });
        return json(200, { ok: true, message: "Pickup confirmed, but seller not onboarded.", recordId });
      }

      if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: { seller_payout_status: "Failed", payout_error: "Invalid seller_payout_amount." },
        });
        return json(200, { ok: true, message: "Pickup confirmed, but payout amount invalid.", recordId });
      }

      // Stripe transfer
      const amountCents = Math.round(payoutAmount * 100);

      try {
        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency: "usd",
          destination,
          description: `Showroom Market seller payout for ${recordId}`,
          metadata: { listingId: recordId, type: "seller_payout" },
        });

        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: {
            seller_payout_status: "Paid",
            payout_sent_at: new Date().toISOString(),
            stripe_transfer_id: transfer.id,
            payout_error: "",
          },
        });

        return json(200, {
          ok: true,
          message: "Pickup confirmed + payout sent ✅",
          recordId,
          stripe_transfer_id: transfer.id,
          payout_amount: payoutAmount,
        });
      } catch (e) {
        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: { seller_payout_status: "Failed", payout_error: String(e.message || "Stripe transfer failed") },
        });
        return json(500, { error: "Pickup confirmed BUT payout failed", recordId, detail: e.message });
      }
    }

    // =========================
    // 3) PAYOUT HISTORY
    // =========================
    if (action === "get_payout_history") {
      const status = String(body.status || "All").trim(); // Paid | Failed | Pending | All
      const limit = Math.min(Math.max(parseInt(body.limit || 75, 10) || 75, 1), 200);

      let filterByFormula = "";
      if (status === "Paid") filterByFormula = `{seller_payout_status}="Paid"`;
      if (status === "Failed") filterByFormula = `{seller_payout_status}="Failed"`;
      if (status === "Pending") filterByFormula = `AND({pickup_confirmed}=TRUE(), OR({seller_payout_status}="", {seller_payout_status}="Pending", {seller_payout_status}="Ready"))`;

      const params = {
        pageSize: String(Math.min(limit, 100)),
        maxRecords: String(limit),
        "sort[0][field]": "payout_sent_at",
        "sort[0][direction]": "desc",
      };
      if (filterByFormula) params.filterByFormula = filterByFormula;

      const data = await airtableQuery({ baseId, table, apiKey, params });

      const records = (data.records || []).map((r) => {
        const f = r.fields || {};
        return {
          id: r.id,
          sellerName: pick(f, ["sellerName", "seller_name"], ""),
          sellerEmail: pick(f, ["sellerEmail", "seller_email"], ""),
          itemTitle: pick(f, ["title", "product_title", "displayName", "item_name"], ""),
          status: String(f.status || ""),
          pickup_confirmed: !!f.pickup_confirmed,
          pickup_confirmed_at: f.pickup_confirmed_at || null,
          seller_payout_status: f.seller_payout_status || "",
          seller_payout_amount: f.seller_payout_amount ?? null,
          payout_sent_at: f.payout_sent_at || null,
          payout_error: f.payout_error || "",
          stripe_transfer_id: f.stripe_transfer_id || "",
          stripe_account_id: f.stripe_account_id || "",
        };
      });

      return json(200, { ok: true, status, count: records.length, records });
    }

    // =========================
    // 4) RETRY PAYOUT
    // =========================
    if (action === "retry_payout") {
      const recordId = String(body.recordId || "").trim();
      if (!recordId.startsWith("rec")) return json(400, { error: "Invalid recordId" });

      const rec = await airtableGetRecord({ baseId, table, recordId, apiKey });
      const f = rec.fields || {};

      if (!f.pickup_confirmed) return json(409, { error: "Cannot retry: pickup_confirmed not true", recordId });

      const payoutStatus = String(f.seller_payout_status || "").trim().toLowerCase();
      const transferId = String(f.stripe_transfer_id || "").trim();

      if (transferId || payoutStatus === "paid") {
        return json(200, { ok: true, message: "Already paid (duplicate protection).", recordId, stripe_transfer_id: transferId || null });
      }

      const destination = String(f.stripe_account_id || "").trim();
      const payoutAmount = Number(f.seller_payout_amount);

      if (!destination) return json(409, { error: "Missing stripe_account_id", recordId });
      if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) return json(409, { error: "Invalid seller_payout_amount", recordId });

      // mark processing
      await airtablePatchRecord({
        baseId, table, recordId, apiKey,
        fields: { seller_payout_status: "Processing", payout_error: "" },
      });

      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(payoutAmount * 100),
          currency: "usd",
          destination,
          description: `Showroom Market seller payout retry for ${recordId}`,
          metadata: { listingId: recordId, type: "seller_payout_retry" },
        });

        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: {
            seller_payout_status: "Paid",
            payout_sent_at: new Date().toISOString(),
            stripe_transfer_id: transfer.id,
            payout_error: "",
          },
        });

        return json(200, { ok: true, message: "Retry payout success ✅", recordId, stripe_transfer_id: transfer.id });
      } catch (e) {
        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: { seller_payout_status: "Failed", payout_error: String(e.message || "Stripe transfer failed") },
        });
        return json(500, { error: "Retry payout failed", recordId, detail: e.message });
      }
    }

    // =========================
    // 5) START SELLER ONBOARDING
    // =========================
    if (action === "start_onboarding") {
      const recordId = String(body.recordId || "").trim();
      if (!recordId.startsWith("rec")) return json(400, { error: "Invalid recordId" });

      const returnUrl = await getEnvOrThrow("STRIPE_CONNECT_RETURN_URL");
      const refreshUrl = await getEnvOrThrow("STRIPE_CONNECT_REFRESH_URL");

      // Load listing; if it already has stripe_account_id use it, else create
      const rec = await airtableGetRecord({ baseId, table, recordId, apiKey });
      const f = rec.fields || {};

      let acctId = String(f.stripe_account_id || "").trim();
      if (!acctId) {
        const acct = await stripe.accounts.create({
          type: "express",
          capabilities: { transfers: { requested: true } },
        });
        acctId = acct.id;

        await airtablePatchRecord({
          baseId, table, recordId, apiKey,
          fields: { stripe_account_id: acctId },
        });
      }

      const link = await stripe.accountLinks.create({
        account: acctId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });

      return json(200, { ok: true, recordId, stripe_account_id: acctId, onboarding_url: link.url });
    }

    return json(400, { error: "Unknown action", action });
  } catch (e) {
    return json(500, { error: "Admin function error", detail: e.message, action });
  }
};
