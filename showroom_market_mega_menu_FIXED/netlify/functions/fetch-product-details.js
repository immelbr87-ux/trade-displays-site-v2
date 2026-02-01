// netlify/functions/fetch-product-details.js
// SKU Auto-Fill System using Claude API
// CommonJS-safe Netlify Function (repo is "type": "commonjs")
//
// Logging upgrade:
// - Adds requestId + timing + structured logs
// - Never logs API keys
// - Returns safe found:false responses when AI is unavailable

let AnthropicMod;
try {
  AnthropicMod = require("@anthropic-ai/sdk");
} catch (e) {
  AnthropicMod = null;
}

const Anthropic = AnthropicMod ? (AnthropicMod.default || AnthropicMod) : null;

console.log("fetch-product-details loaded");

function makeReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function extractFirstJsonObject(text) {
  // Tries:
  // 1) direct parse
  // 2) strip code fences
  // 3) find first {...} block (best-effort)
  const raw = String(text || "");

  // direct
  try { return JSON.parse(raw); } catch {}

  // strip fences
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(stripped); } catch {}

  // best-effort first object
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = stripped.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

exports.handler = async (event) => {
  const requestId = makeReqId();
  const t0 = Date.now();

  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle OPTIONS request (CORS preflight)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed", requestId }),
    };
  }

  const bodyObj = safeJsonParse(event.body || "{}", {});
  const sku = bodyObj.sku;
  const brand = bodyObj.brand;

  // Validate input
  if (!sku || !brand) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "SKU and brand are required",
        found: false,
        requestId,
      }),
    };
  }

  const searchUrl = getManufacturerSearchUrl(brand, sku);

  console.log(JSON.stringify({
    tag: "fetch_product_details_start",
    requestId,
    sku,
    brand,
    hasSearchUrl: Boolean(searchUrl),
    hasAnthropicSDK: Boolean(Anthropic),
  }));

  if (!searchUrl) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Unsupported brand",
        found: false,
        message: "This brand is not yet supported. Please enter details manually.",
        requestId,
      }),
    };
  }

  // Support both ANTHROPIC_API_KEY (your current Netlify var in screenshot) and ANTHROPIC_API_KEY (typo-proof)
  const anthropicKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_KEY ||
    process.env.ANTHROPIC_TOKEN ||
    null;

  // If Anthropic SDK isn't installed or key is missing, fail safely
  if (!Anthropic) {
    console.log(JSON.stringify({
      tag: "fetch_product_details_ai_unavailable",
      requestId,
      reason: "missing_sdk",
      ms: Date.now() - t0
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: false,
        message: "AI auto-fill unavailable (missing SDK). Please enter details manually.",
        search_url: searchUrl,
        requestId,
      }),
    };
  }

  if (!anthropicKey) {
    console.log(JSON.stringify({
      tag: "fetch_product_details_ai_unavailable",
      requestId,
      reason: "missing_api_key",
      ms: Date.now() - t0
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: false,
        message: "AI auto-fill unavailable (missing API key). Please enter details manually.",
        search_url: searchUrl,
        requestId,
      }),
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const model = "claude-sonnet-4-20250514"; // keep your selected model

    console.log(JSON.stringify({
      tag: "fetch_product_details_call_anthropic",
      requestId,
      model,
      searchUrl,
    }));

    const message = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a product data extraction assistant for a B2B kitchen & bath marketplace.

SKU: "${sku}"
Brand: "${brand}"

Search URL (for the human to verify): ${searchUrl}

IMPORTANT CONSTRAINT:
- You cannot browse the internet or actually visit URLs.
- Do NOT claim you "visited" or "found" a page.
- Instead, infer likely product attributes based on SKU/model patterns and brand knowledge.
- If you are not confident, return found:false.

Return ONLY a valid JSON object (no markdown, no explanation).

Required JSON format:
{
  "found": true,
  "product_name": "Full product name",
  "brand": "${brand}",
  "category": "One of: Kitchen Cabinetry, Bathroom Vanities, Appliances, Faucets & Fixtures, Sinks & Basins, Lighting, Hardware, Accessories",
  "subcategory": "More specific category",
  "description": "Detailed product description (2-3 sentences)",
  "retail_price": 0,
  "dimensions": {
    "width": 0,
    "depth": 0,
    "height": 0,
    "unit": "inches"
  },
  "weight": 0,
  "finish": "Product finish/color",
  "material": "Primary material",
  "specifications": {},
  "model_number": "${sku}",
  "upc": "UPC if available",
  "warranty": "Warranty info if available",
  "installation_type": "Installation type if applicable"
}

If product not found / low confidence, return:
{
  "found": false,
  "message": "Product not found or insufficient confidence for SKU ${sku}"
}`,
        },
      ],
    });

    const responseText = message?.content?.[0]?.text || "";
    console.log(JSON.stringify({
      tag: "fetch_product_details_anthropic_returned",
      requestId,
      chars: responseText.length,
    }));

    const productData = extractFirstJsonObject(responseText);

    if (!productData || typeof productData !== "object") {
      console.error(JSON.stringify({
        tag: "fetch_product_details_parse_failed",
        requestId,
        ms: Date.now() - t0
      }));

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Failed to parse product data",
          found: false,
          message: "Unable to extract product details. Please try again or enter manually.",
          search_url: searchUrl,
          requestId,
        }),
      };
    }

    // If product not found, return 404 (keep your behavior)
    if (!productData.found) {
      console.log(JSON.stringify({
        tag: "fetch_product_details_not_found",
        requestId,
        message: productData.message || null,
        ms: Date.now() - t0
      }));

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          found: false,
          message: productData.message || `Product not found for SKU: ${sku}`,
          suggestion: "Double-check the SKU or try entering details manually.",
          search_url: searchUrl,
          requestId,
        }),
      };
    }

    // Add metadata
    productData.fetched_at = new Date().toISOString();
    productData.source = "claude_api";
    productData.search_url = searchUrl;
    productData.confidence = productData.confidence || "medium";
    productData.requestId = requestId;

    // Step 5: Calculate suggested pricing (50% off retail)
    if (productData.retail_price) {
      productData.suggested_price = Math.round(Number(productData.retail_price) * 0.5);
      productData.suggested_range = {
        min: Math.round(Number(productData.retail_price) * 0.3),
        max: Math.round(Number(productData.retail_price) * 0.6),
      };
      productData.savings_percentage = 50;
    }

    console.log(JSON.stringify({
      tag: "fetch_product_details_success",
      requestId,
      found: true,
      product_name: productData.product_name || null,
      ms: Date.now() - t0
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(productData),
    };
  } catch (error) {
    console.error(JSON.stringify({
      tag: "fetch_product_details_error",
      requestId,
      message: error?.message || String(error),
      ms: Date.now() - t0
    }));

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        found: false,
        message: "An error occurred while fetching product details. Please try again.",
        details: process.env.NODE_ENV === "development" ? (error?.message || String(error)) : undefined,
        requestId,
      }),
    };
  }
};

/**
 * Get manufacturer search URL based on brand
 */
function getManufacturerSearchUrl(brand, sku) {
  const brandLower = String(brand || "").toLowerCase();

  const urls = {
    "kohler": `https://www.kohler.com/us/search?q=${sku}`,
    "moen": `https://www.moen.com/search?q=${sku}`,
    "delta": `https://www.deltafaucet.com/search?q=${sku}`,
    "american standard": `https://www.americanstandard.com/search?q=${sku}`,
    "subzero": `https://www.subzero-wolf.com/search?q=${sku}`,
    "sub-zero": `https://www.subzero-wolf.com/search?q=${sku}`,
    "wolf": `https://www.subzero-wolf.com/search?q=${sku}`,
    "thermador": `https://www.thermador.com/us/search?q=${sku}`,
    "kitchenaid": `https://www.kitchenaid.com/search.html?search=${sku}`,
    "hansgrohe": `https://www.hansgrohe-usa.com/search?q=${sku}`,
    "brizo": `https://www.brizo.com/search?q=${sku}`,
    "rohl": `https://rohlhome.com/search?q=${sku}`,
    "waterworks": `https://www.waterworks.com/search?q=${sku}`,
    "toto": `https://www.totousa.com/search?q=${sku}`,
    "duravit": `https://www.duravit.us/search?q=${sku}`,
    "grohe": `https://www.grohe.us/en_us/search?q=${sku}`,
    "viking": `https://www.vikingrange.com/search?q=${sku}`,
    "jenn-air": `https://www.jennair.com/search.html?search=${sku}`,
    "ge": `https://www.geappliances.com/search?q=${sku}`,
    "bosch": `https://www.bosch-home.com/us/search?q=${sku}`,
    "dacor": `https://www.dacor.com/us/search?q=${sku}`,
  };

  return urls[brandLower] || null;
}
