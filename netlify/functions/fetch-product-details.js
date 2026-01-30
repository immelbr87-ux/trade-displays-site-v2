// netlify/functions/fetch-product-details.js
// SKU Auto-Fill System using Claude API
// CommonJS-safe Netlify Function (repo is "type": "commonjs")

let AnthropicMod;
try {
  AnthropicMod = require("@anthropic-ai/sdk");
} catch (e) {
  AnthropicMod = null;
}

const Anthropic = AnthropicMod ? (AnthropicMod.default || AnthropicMod) : null;

console.log("fetch-product-details loaded");

exports.handler = async (event) => {
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
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { sku, brand } = JSON.parse(event.body || "{}");

    // Validate input
    if (!sku || !brand) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "SKU and brand are required",
          found: false,
        }),
      };
    }

    console.log("Fetching product details", { sku, brand });

    // Step 1: Check cache first (if you have a database)
    // const cached = await checkCache(sku);
    // if (cached) return { statusCode: 200, headers, body: JSON.stringify(cached) };

    // Step 2: Get manufacturer search URL
    const searchUrl = getManufacturerSearchUrl(brand, sku);

    if (!searchUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Unsupported brand",
          found: false,
          message: "This brand is not yet supported. Please enter details manually.",
        }),
      };
    }

    // If Anthropic SDK isn't installed or key is missing, fail safely
    if (!Anthropic) {
      console.log("Anthropic SDK not available (missing dependency).");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          found: false,
          message: "AI auto-fill unavailable (missing SDK). Please enter details manually.",
          search_url: searchUrl,
        }),
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("Missing ANTHROPIC_API_KEY.");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          found: false,
          message: "AI auto-fill unavailable (missing API key). Please enter details manually.",
          search_url: searchUrl,
        }),
      };
    }

    // Step 3: Use Claude to assist with extraction
    // IMPORTANT: Claude cannot actually browse/visit URLs. We must instruct it not to claim it did.
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const model = "claude-sonnet-4-20250514"; // keep your selected model
    console.log("Calling Anthropic model", { model, searchUrl });

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
  "specifications": {
    "key1": "value1",
    "key2": "value2"
  },
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

    // Extract JSON from Claude's response
    let productData;
    try {
      const responseText = message?.content?.[0]?.text || "";
      console.log("Claude response length", { chars: responseText.length });

      // Remove markdown code blocks if present
      const jsonText = responseText
        .replace(/```json\n?/gi, "")
        .replace(/```\n?/g, "")
        .trim();

      productData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Failed to parse Claude response:", parseError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Failed to parse product data",
          found: false,
          message: "Unable to extract product details. Please try again or enter manually.",
          search_url: searchUrl,
        }),
      };
    }

    // If product not found, return 404 (keep your behavior)
    if (!productData.found) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          found: false,
          message: productData.message || `Product not found for SKU: ${sku}`,
          suggestion: "Double-check the SKU or try entering details manually.",
          search_url: searchUrl,
        }),
      };
    }

    // Add metadata
    productData.fetched_at = new Date().toISOString();
    productData.source = "claude_api";
    productData.search_url = searchUrl;
    productData.confidence = productData.confidence || "medium";

    // Step 4: Cache the result (if you have a database)
    // await cacheProduct(sku, productData);

    // Step 5: Calculate suggested pricing (50% off retail)
    if (productData.retail_price) {
      productData.suggested_price = Math.round(productData.retail_price * 0.5);
      productData.suggested_range = {
        min: Math.round(productData.retail_price * 0.3),
        max: Math.round(productData.retail_price * 0.6),
      };
      productData.savings_percentage = 50;
    }

    console.log("Successfully produced product data", {
      product_name: productData.product_name,
      found: productData.found,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(productData),
    };
  } catch (error) {
    console.error("Error fetching product details:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        found: false,
        message: "An error occurred while fetching product details. Please try again.",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
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

/**
 * Cache product data (implement with your database)
 */
async function cacheProduct(sku, data) {
  // TODO: Implement database caching
  // Example with PostgreSQL:
  // await db.query(
  //   'INSERT INTO product_cache (sku, data, created_at) VALUES ($1, $2, NOW())',
  //   [sku, JSON.stringify(data)]
  // );
}

/**
 * Check cache for existing product data
 */
async function checkCache(sku) {
  // TODO: Implement database cache lookup
  // Example with PostgreSQL:
  // const result = await db.query(
  //   'SELECT data FROM product_cache WHERE sku = $1 AND created_at > NOW() - INTERVAL \'30 days\'',
  //   [sku]
  // );
  // return result.rows[0]?.data || null;
  return null;
}
