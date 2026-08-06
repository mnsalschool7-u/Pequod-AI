const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

dotenv.config();

const requiredEnvVars = [];
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
const adminPassword = process.env.ADMIN_PASSWORD || "";
const notificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "";
const pokeWebhookUrl = process.env.POKE_WEBHOOK_URL || "";
const pokeApiToken = process.env.POKE_API_TOKEN || "";
const databaseUrl = process.env.DATABASE_URL || "";

const app = express();
const demoCorsAllowedOrigins = new Set([
  "https://pequodai.app",
  "https://www.pequodai.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const publicDir = __dirname;
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const ordersFile = path.join(dataDir, "orders.json");
const feedbackFile = path.join(dataDir, "feedback.json");
const statusFile = path.join(dataDir, "status.json");
const uploadsDir = path.join(dataDir, "uploads");
let dbPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  : null;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      callback(null, `${Date.now()}-${safeName}`);
    },
  }),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }

    callback(new Error("Only image uploads are supported."));
  },
});

const llamaParseUploadsDir = path.join(uploadsDir, "llamaparse");
fs.mkdirSync(llamaParseUploadsDir, { recursive: true });

const llamaParseUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, llamaParseUploadsDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".pdf";
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const isPdfMime = file.mimetype === "application/pdf";
    const isPdfName = path.extname(file.originalname).toLowerCase() === ".pdf";

    if (isPdfMime && isPdfName) {
      callback(null, true);
      return;
    }

    callback(new Error("Only PDF files are supported for the LlamaParse demo."));
  },
});

const smtpConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && notificationEmail);
const mailTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: `${process.env.SMTP_SECURE || "true"}` !== "false",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;
const FREE_DELIVERY_CODE = "CODE";

function getEasternMinutesSinceMidnight() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);

  return hour * 60 + minute;
}

function isBoostBossSleeping() {
  const minutes = getEasternMinutesSinceMidnight();

  return minutes >= 30 && minutes < 7 * 60;
}

function hasFreeDeliveryPromo(code = "") {
  return `${code}`.trim().toUpperCase() === FREE_DELIVERY_CODE;
}

function escapeXml(value = "") {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getMarkdownPages(result) {
  const pages = result?.markdown?.pages;

  if (!Array.isArray(pages)) {
    return [];
  }

  return pages.map((page, index) => ({
    pageNumber: page.page || page.page_number || index + 1,
    markdown: page.markdown || "",
  }));
}

const productFields = [
  ["document_type", "Document type"],
  ["product_name", "Product name"],
  ["model_number", "Model number"],
  ["product_description", "Product description"],
  ["primary_material", "Primary material"],
  ["secondary_materials", "Secondary materials"],
  ["components", "Components"],
  ["base_material", "Base material"],
  ["light_source", "Light source"],
  ["power_source", "Power source"],
  ["voltage", "Voltage"],
  ["wattage", "Wattage"],
  ["dimensions", "Dimensions"],
  ["weight", "Weight"],
  ["intended_use", "Intended use"],
  ["country_of_origin", "Country of origin"],
];

function cleanText(value = "") {
  return `${value}`.replace(/\s+/g, " ").trim();
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function findPageEvidence(pages, patterns) {
  for (const page of pages) {
    const lines = `${page.markdown || ""}`
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean);

    for (const line of lines) {
      if (patterns.some((pattern) => pattern.test(line))) {
        return {
          page: page.pageNumber,
          excerpt: line.slice(0, 220),
        };
      }
    }
  }

  return null;
}

function findFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return cleanText(match[1].replace(/[|:]/g, " "));
    }
  }

  return null;
}

function makeField(key, value, evidence = null, status = "Extracted") {
  const isArray = Array.isArray(value);
  const hasValue = isArray ? value.length > 0 : Boolean(value);

  return {
    key,
    label: productFields.find(([fieldKey]) => fieldKey === key)?.[1] || key,
    value: hasValue ? value : isArray ? [] : null,
    sourcePage: hasValue ? evidence?.page || null : null,
    supportingText: hasValue ? evidence?.excerpt || "" : "",
    status: hasValue ? status : "Missing",
  };
}

function extractProductRecord(pages) {
  const markdown = pages.map((page) => page.markdown || "").join("\n");
  const text = cleanText(markdown);
  const lower = text.toLowerCase();

  const evidence = {
    document_type: findPageEvidence(pages, [/product information/i, /specification/i, /product sheet/i, /manual/i]),
    product_name: findPageEvidence(pages, [/product name/i, /item name/i, /salt lamp/i, /lamp/i]),
    model_number: findPageEvidence(pages, [/model/i, /sku/i, /item no/i, /item number/i]),
    product_description: findPageEvidence(pages, [/description/i, /product information/i, /lamp/i]),
    primary_material: findPageEvidence(pages, [/material/i, /himalayan/i, /salt/i, /rock/i, /wood/i]),
    components: findPageEvidence(pages, [/component/i, /cord/i, /socket/i, /switch/i, /bulb/i, /base/i]),
    base_material: findPageEvidence(pages, [/wooden base/i, /wood base/i, /base material/i]),
    light_source: findPageEvidence(pages, [/bulb/i, /light source/i, /lamp/i]),
    power_source: findPageEvidence(pages, [/cord/i, /plug/i, /power source/i, /electric/i]),
    voltage: findPageEvidence(pages, [/\b\d{2,3}\s?v\b/i, /voltage/i]),
    wattage: findPageEvidence(pages, [/\b\d{1,4}\s?w\b/i, /wattage/i, /watts/i]),
    dimensions: findPageEvidence(pages, [/dimension/i, /\b\d+(\.\d+)?\s?(in|inch|cm|mm)\b/i]),
    weight: findPageEvidence(pages, [/weight/i, /\b\d+(\.\d+)?\s?(lb|lbs|kg|g)\b/i]),
    intended_use: findPageEvidence(pages, [/intended use/i, /use/i, /decorative/i, /household/i, /ambient/i]),
    country_of_origin: findPageEvidence(pages, [/country of origin/i, /made in/i, /origin/i]),
  };

  const productName =
    findFirstMatch(text, [
      /product name\s*[:|]\s*([^\n\r]+)/i,
      /item name\s*[:|]\s*([^\n\r]+)/i,
      /([A-Z][A-Za-z0-9 ]{2,80}\s+salt lamp)/i,
    ]) || (lower.includes("salt lamp") ? "Salt lamp" : null);

  const components = uniqueValues([
    lower.includes("cord") ? "Electrical cord" : "",
    lower.includes("socket") ? "Socket" : "",
    lower.includes("switch") ? "Switch" : "",
    lower.includes("bulb") ? "Replaceable bulb" : "",
    lower.includes("base") ? "Base" : "",
  ]);

  const secondaryMaterials = uniqueValues([
    lower.includes("wood") ? "Wood" : "",
    lower.includes("metal") ? "Metal" : "",
    lower.includes("plastic") ? "Plastic" : "",
  ]);

  const voltage = findFirstMatch(text, [/(\b\d{2,3}\s?v(?:olts?)?\b)/i, /voltage\s*[:|]\s*([^\n\r]+)/i]);
  const wattage = findFirstMatch(text, [/(\b\d{1,4}\s?w(?:atts?)?\b)/i, /wattage\s*[:|]\s*([^\n\r]+)/i]);
  const dimensions = findFirstMatch(text, [/dimensions?\s*[:|]\s*([^\n\r]+)/i]);
  const weight = findFirstMatch(text, [/weight\s*[:|]\s*([^\n\r]+)/i]);
  const country = findFirstMatch(text, [/country of origin\s*[:|]\s*([^\n\r]+)/i, /made in\s+([A-Za-z ]{2,60})/i]);
  const model = findFirstMatch(text, [/(?:model|sku|item no\.?|item number)\s*[:|]\s*([A-Za-z0-9 ._/]+)/i]);
  const intendedUse = findFirstMatch(text, [/intended use\s*[:|]\s*([^\n\r]+)/i]) ||
    (/(decorative|ambient|household)/i.test(text) ? cleanText(text.match(/.{0,80}(decorative|ambient|household).{0,80}/i)?.[0] || "") : null);

  const primaryMaterial = /himalayan|rock salt|salt/i.test(text) ? "Natural salt" : findFirstMatch(text, [/primary material\s*[:|]\s*([^\n\r]+)/i, /material\s*[:|]\s*([^\n\r]+)/i]);
  const baseMaterial = /wooden base|wood base/i.test(text) ? "Wood" : null;
  const lightSource = /replaceable bulb|bulb/i.test(text) ? "Replaceable bulb" : null;
  const powerSource = /electric|cord|plug/i.test(text) ? "Electrical cord" : null;
  const description = findFirstMatch(text, [/description\s*[:|]\s*([^\n\r]+)/i]) ||
    (productName ? cleanText(text.slice(0, 220)) : null);
  const documentType = /specification|product information|product sheet/i.test(text) ? "Product information document" : null;

  const fields = [
    makeField("document_type", documentType, evidence.document_type),
    makeField("product_name", productName, evidence.product_name),
    makeField("model_number", model, evidence.model_number),
    makeField("product_description", description, evidence.product_description),
    makeField("primary_material", primaryMaterial, evidence.primary_material),
    makeField("secondary_materials", secondaryMaterials, evidence.primary_material),
    makeField("components", components, evidence.components),
    makeField("base_material", baseMaterial, evidence.base_material),
    makeField("light_source", lightSource, evidence.light_source),
    makeField("power_source", powerSource, evidence.power_source),
    makeField("voltage", voltage, evidence.voltage),
    makeField("wattage", wattage, evidence.wattage),
    makeField("dimensions", dimensions, evidence.dimensions),
    makeField("weight", weight, evidence.weight),
    makeField("intended_use", intendedUse, evidence.intended_use),
    makeField("country_of_origin", country, evidence.country_of_origin),
  ];

  const missingInformation = fields.filter((field) => field.status === "Missing").map((field) => field.label);

  return {
    document_type: documentType,
    product_name: productName,
    model_number: model,
    product_description: description,
    primary_material: primaryMaterial,
    secondary_materials: secondaryMaterials,
    components,
    base_material: baseMaterial,
    light_source: lightSource,
    power_source: powerSource,
    voltage,
    wattage,
    dimensions,
    weight,
    intended_use: intendedUse,
    country_of_origin: country,
    missing_information: missingInformation,
    fields,
  };
}

function buildRetrievalProfile(record) {
  const values = [
    record.product_name,
    record.product_description,
    record.primary_material,
    record.base_material,
    record.light_source,
    record.power_source,
    record.intended_use,
    ...(record.secondary_materials || []),
    ...(record.components || []),
  ].filter(Boolean);
  const haystack = values.join(" ").toLowerCase();
  const concepts = uniqueValues([
    record.product_name,
    haystack.includes("lamp") ? "electric decorative lamp" : "",
    haystack.includes("salt") ? "natural mineral lamp" : "",
    haystack.includes("wood") ? "wood base" : "",
    haystack.includes("bulb") ? "replaceable bulb" : "",
    haystack.includes("cord") ? "electrical cord" : "",
    haystack.includes("socket") ? "socket" : "",
    haystack.includes("decorative") ? "decorative household lighting" : "",
    haystack.includes("composite") || values.length > 3 ? "composite good" : "",
    "essential character",
  ]);

  const query = uniqueValues([
    record.product_name,
    record.primary_material,
    record.base_material,
    record.light_source,
    record.power_source,
    record.intended_use,
    ...concepts,
  ]).join(" ");

  return {
    productClass: haystack.includes("lamp") ? "Electric decorative household lamp" : record.product_name || "Product class not established",
    principalFunction: record.intended_use || null,
    primaryMaterial: record.primary_material || null,
    secondaryMaterials: record.secondary_materials || [],
    electricalComponents: (record.components || []).filter((component) => /cord|socket|switch|bulb|electric/i.test(component)),
    intendedUse: record.intended_use || null,
    countryOfOrigin: record.country_of_origin || null,
    classificationKeywords: concepts,
    query,
  };
}

async function retrieveCustomsPrecedents(client, profile) {
  const indexId = process.env.LLAMA_CLOUD_INDEX_ID || "";

  if (!indexId) {
    return {
      connected: false,
      indexId: null,
      query: profile.query,
      results: [],
      message: "No customs ruling index has been connected yet.",
    };
  }

  const response = await client.beta.retrieval.retrieve({
    index_id: indexId,
    query: profile.query,
    top_k: 5,
  });

  return {
    connected: true,
    indexId,
    query: profile.query,
    results: (response?.results || []).map((result) => ({
      content: cleanText(result.content || "").slice(0, 900),
      score: result.score ?? null,
      rerankScore: result.rerank_score ?? null,
      metadata: result.metadata || null,
      staticFields: result.static_fields || null,
    })),
    message: "Customs ruling index retrieval completed.",
  };
}

function getSafeLlamaError(error) {
  if (!error) {
    return "LlamaParse request failed.";
  }

  if (error.status) {
    return `LlamaParse request failed with status ${error.status}.`;
  }

  if (error.name === "PollingTimeoutError") {
    return "LlamaParse timed out before the document finished processing.";
  }

  return error.message || "LlamaParse request failed.";
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.statusCode = 504;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function parsePdfWithLlamaParse(filePath) {
  if (!process.env.LLAMA_CLOUD_API_KEY) {
    const error = new Error("LLAMA_CLOUD_API_KEY is not configured on the server.");
    error.statusCode = 503;
    throw error;
  }

  const { default: LlamaCloudDefault, LlamaCloud } = await import("@llamaindex/llama-cloud");
  const LlamaCloudClient = LlamaCloudDefault || LlamaCloud;
  const client = new LlamaCloudClient({ timeout: 120000 });

  const result = await withTimeout(
    client.parsing.parse(
      {
        upload_file: fs.createReadStream(filePath),
        tier: "cost_effective",
        version: "latest",
        expand: ["markdown"],
      },
      {
        pollingInterval: 2,
        timeout: 180,
      }
    ),
    180000,
    "LlamaParse timed out before the document finished processing."
  );

  const pages = getMarkdownPages(result);
  const productRecord = extractProductRecord(pages);
  const retrievalProfile = buildRetrievalProfile(productRecord);
  let customsRetrieval;

  try {
    customsRetrieval = await retrieveCustomsPrecedents(client, retrievalProfile);
  } catch (error) {
    console.error("Customs retrieval skipped:", getSafeLlamaError(error));
    customsRetrieval = {
      connected: Boolean(process.env.LLAMA_CLOUD_INDEX_ID),
      indexId: process.env.LLAMA_CLOUD_INDEX_ID || null,
      query: retrievalProfile.query,
      results: [],
      message: "Customs retrieval could not be completed. Document parsing still succeeded.",
    };
  }

  return {
    submitted: true,
    fileId: result?.file_id || null,
    jobId: result?.job?.id || null,
    status: result?.job?.status || "UNKNOWN",
    outputFormat: pages.length > 0 ? "markdown" : "unknown",
    pagesProcessed: pages.length || null,
    markdown: pages.map((page) => `<!-- Page ${page.pageNumber} -->\n${page.markdown}`).join("\n\n"),
    pages,
    completed: result?.job?.status === "COMPLETED",
    productRecord,
    retrievalProfile,
    customsRetrieval,
  };
}

function readOrders() {
  try {
    const raw = fs.readFileSync(ordersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

function readFeedback() {
  try {
    const raw = fs.readFileSync(feedbackFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function writeFeedback(items) {
  fs.writeFileSync(feedbackFile, JSON.stringify(items, null, 2));
}

function readAvailabilityStatus() {
  try {
    const raw = fs.readFileSync(statusFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      isOpen: Boolean(parsed.isOpen),
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { isOpen: false, updatedAt: null };
    }

    throw error;
  }
}

function writeAvailabilityStatus(status) {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
}

function upsertOrder(nextOrder) {
  const orders = readOrders();
  const existingIndex = orders.findIndex((order) => order.sessionId === nextOrder.sessionId);

  if (existingIndex >= 0) {
    orders[existingIndex] = { ...orders[existingIndex], ...nextOrder };
  } else {
    orders.unshift(nextOrder);
  }

  writeOrders(orders);
}

async function initDatabase() {
  if (!dbPool) {
    return;
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (error) {
    console.error("Database initialization failed, falling back to local file persistence:", error);

    try {
      await dbPool.end();
    } catch (_shutdownError) {
      // Ignore pool shutdown errors during fallback.
    }

    dbPool = null;
  }
}

async function readOrdersStore() {
  if (!dbPool) {
    return readOrders();
  }

  const result = await dbPool.query(`
    SELECT data
    FROM orders
    ORDER BY COALESCE((data->>'createdAt')::timestamptz, created_at) DESC;
  `);
  return result.rows.map((row) => row.data);
}

async function upsertOrderStore(order) {
  if (!dbPool) {
    upsertOrder(order);
    return;
  }

  await dbPool.query(
    `
      INSERT INTO orders (id, data)
      VALUES ($1, $2)
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data;
    `,
    [order.sessionId, order]
  );
}

async function readFeedbackStore() {
  if (!dbPool) {
    return readFeedback();
  }

  const result = await dbPool.query(`
    SELECT data
    FROM feedback
    ORDER BY COALESCE((data->>'createdAt')::timestamptz, created_at) DESC;
  `);
  return result.rows.map((row) => row.data);
}

async function upsertFeedbackStore(feedback) {
  if (!dbPool) {
    const feedbackItems = readFeedback();
    feedbackItems.unshift(feedback);
    writeFeedback(feedbackItems);
    return;
  }

  await dbPool.query(
    `
      INSERT INTO feedback (id, data)
      VALUES ($1, $2)
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data;
    `,
    [feedback.id, feedback]
  );
}

async function readAvailabilityStatusStore() {
  if (!dbPool) {
    return readAvailabilityStatus();
  }

  const result = await dbPool.query("SELECT value FROM app_state WHERE key = $1;", [
    "availability",
  ]);

  if (result.rows.length === 0) {
    return { isOpen: false, updatedAt: null };
  }

  return {
    isOpen: Boolean(result.rows[0].value.isOpen),
    updatedAt: result.rows[0].value.updatedAt || null,
  };
}

async function writeAvailabilityStatusStore(status) {
  if (!dbPool) {
    writeAvailabilityStatus(status);
    return;
  }

  await dbPool.query(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `,
    ["availability", status]
  );
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";

  return cookieHeader.split(";").reduce((cookies, part) => {
    const trimmed = part.trim();

    if (!trimmed) {
      return cookies;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
    const value = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : "";
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function isAdminAuthenticated(req) {
  if (!adminPassword) {
    return false;
  }

  const cookies = parseCookies(req);
  return cookies["grabbit_admin"] === adminPassword;
}

function requireAdmin(req, res, next) {
  if (isAdminAuthenticated(req)) {
    return next();
  }

  return res.status(401).json({ error: "Admin login required." });
}

function summarizeLocation(order) {
  if (order.locationType === "Dorm") {
    const dormBuilding = order.woodlandHillBuilding || order.dormBuilding;
    const community = order.vanWinkleCommunity ? `, ${order.vanWinkleCommunity}` : "";
    return `${dormBuilding} Room ${order.roomNumber}${community}`;
  }

  return `${order.building} - ${order.classroomDetails}`;
}

async function sendOrderNotification(order) {
  if (!mailTransport || !notificationEmail) {
    return false;
  }

  const deliveryLine = order.deliveryDetails
    ? `${order.deliveryType} - ${order.deliveryDetails}`
    : order.deliveryType;

  await mailTransport.sendMail({
    from: process.env.SMTP_USER,
    to: notificationEmail,
    subject: `New Grabbit order from ${order.customerName}`,
    text: [
      `New Grabbit order received.`,
      ``,
      `Name: ${order.customerName}`,
      `Phone: ${order.phone}`,
      `Pickup location: ${order.orderedFrom}`,
      `Delivery location: ${order.locationSummary}`,
      `After-hours dropoff/meet details: ${order.afterHoursDetails || "N/A"}`,
      `Promo code: ${order.promoCode || "N/A"}`,
      `Delivery fee: $${((order.amountTotal || 0) / 100).toFixed(2)}`,
      `Delivery type: ${deliveryLine}`,
      `Payment method: ${order.paymentMethod}`,
      `Screenshot: ${order.screenshotPath ? `${process.env.PUBLIC_BASE_URL || ""}${order.screenshotPath}` : "Uploaded on server"}`,
      `Order ID: ${order.sessionId}`,
    ].join("\n"),
  });

  return true;
}

async function sendFeedbackNotification(feedback) {
  if (!mailTransport || !notificationEmail) {
    return false;
  }

  await mailTransport.sendMail({
    from: process.env.SMTP_USER,
    to: notificationEmail,
    subject: `New Grabbit suggestion`,
    text: [
      `New Grabbit suggestion received.`,
      ``,
      `Name: ${feedback.name}`,
      `Message: ${feedback.message}`,
      `Feedback ID: ${feedback.id}`,
    ].join("\n"),
  });

  return true;
}

async function sendEventFoodNotification(submission) {
  if (!mailTransport || !notificationEmail) {
    return false;
  }

  await mailTransport.sendMail({
    from: process.env.SMTP_USER,
    to: notificationEmail,
    subject: `New Grabbit event leftovers submission`,
    text: [
      `New event leftovers submission received.`,
      ``,
      `Location: ${submission.location}`,
      `Memo: ${submission.memo}`,
      `Screenshot: ${submission.screenshotPath ? `${process.env.PUBLIC_BASE_URL || ""}${submission.screenshotPath}` : "Uploaded on server"}`,
      `Submission ID: ${submission.id}`,
    ].join("\n"),
  });

  return true;
}

async function sendPokeNotification(order) {
  if (!pokeWebhookUrl || !pokeApiToken) {
    console.warn("Poke notification skipped: missing POKE_WEBHOOK_URL or POKE_API_TOKEN.");
    return false;
  }

  const response = await fetch(pokeWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pokeApiToken}`,
    },
    body: JSON.stringify({
      name: order.customerName,
      phone: order.phone,
      pickup: order.orderedFrom,
      delivery: order.locationSummary,
      type: order.deliveryType,
      payment: order.paymentMethod,
      orderId: order.sessionId,
    }),
  });

  if (!response.ok) {
    let responseBody = "";

    try {
      responseBody = (await response.text()).trim();
    } catch (_error) {
      responseBody = "";
    }

    const responseSummary = responseBody ? `: ${responseBody.slice(0, 280)}` : "";
    throw new Error(`Poke notification failed with status ${response.status}${responseSummary}`);
  }

  return true;
}

// Allow the static Pequod site to call the separate parser API without exposing credentials.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/demo/llamaparse")) {
    return next();
  }

  const origin = req.headers.origin;

  if (demoCorsAllowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json());
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/status", async (_req, res) => {
  try {
    return res.json(await readAvailabilityStatusStore());
  } catch (error) {
    return res.status(500).json({ error: "Unable to read live availability." });
  }
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: isAdminAuthenticated(req) });
});

app.post("/api/admin/status", requireAdmin, async (req, res) => {
  const nextStatus = {
    isOpen: Boolean(req.body.isOpen),
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeAvailabilityStatusStore(nextStatus);
    return res.json(nextStatus);
  } catch (error) {
    return res.status(500).json({ error: "Unable to update live availability." });
  }
});

app.post("/api/admin/login", (req, res) => {
  if (!adminPassword) {
    return res.status(503).json({ error: "Admin password is not configured on the server." });
  }

  if (req.body.password !== adminPassword) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }

  res.setHeader(
    "Set-Cookie",
    `grabbit_admin=${encodeURIComponent(adminPassword)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
  );
  return res.json({ authenticated: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    "grabbit_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
  return res.json({ authenticated: false });
});

app.post("/api/upload-screenshot", upload.single("orderScreenshot"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload a screenshot image." });
  }

  return res.json({
    screenshotPath: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
  });
});

app.get("/api/orders", requireAdmin, async (_req, res) => {
  try {
    return res.json(await readOrdersStore());
  } catch (error) {
    return res.status(500).json({ error: "Unable to read saved orders." });
  }
});

app.get("/api/orders/:sessionId", requireAdmin, async (req, res) => {
  try {
    const order = (await readOrdersStore()).find((entry) => entry.sessionId === req.params.sessionId);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.json(order);
  } catch (error) {
    return res.status(500).json({ error: "Unable to read saved order." });
  }
});

app.get("/api/feedback", requireAdmin, async (_req, res) => {
  try {
    return res.json(await readFeedbackStore());
  } catch (error) {
    return res.status(500).json({ error: "Unable to read feedback." });
  }
});

app.post("/api/feedback", async (req, res) => {
  const message = `${req.body.message || ""}`.trim();
  const name = `${req.body.name || "Anonymous"}`.trim() || "Anonymous";

  if (!message) {
    return res.status(400).json({ error: "Please include a suggestion." });
  }

  const feedback = {
    id: `feedback_${crypto.randomUUID()}`,
    name,
    message,
    createdAt: new Date().toISOString(),
  };

  await upsertFeedbackStore(feedback);

  try {
    const notificationSent = await sendFeedbackNotification(feedback);
    return res.json({ ...feedback, notificationSent });
  } catch (error) {
    console.error("Feedback notification failed:", error.message);
    return res.json({ ...feedback, notificationSent: false });
  }
});

app.post("/api/event-food", upload.single("eventScreenshot"), async (req, res) => {
  const location = `${req.body.location || ""}`.trim();
  const memo = `${req.body.memo || ""}`.trim();

  if (!location) {
    return res.status(400).json({ error: "Please include the pickup location." });
  }

  if (!memo) {
    return res.status(400).json({ error: "Please include a memo." });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Please include a screenshot." });
  }

  const submission = {
    id: `event_food_${crypto.randomUUID()}`,
    type: "event-food",
    location,
    memo,
    screenshotPath: `/uploads/${req.file.filename}`,
    createdAt: new Date().toISOString(),
  };

  await upsertFeedbackStore(submission);

  try {
    const notificationSent = await sendEventFoodNotification(submission);
    return res.json({ ...submission, notificationSent });
  } catch (error) {
    console.error("Event food notification failed:", error.message);
    return res.json({ ...submission, notificationSent: false });
  }
});

// LlamaParse demo: accepts a PDF, sends it to the real LlamaCloud service, and returns parsed markdown.
app.post("/api/demo/llamaparse", llamaParseUpload.single("document"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload a PDF document." });
  }

  try {
    const parseResult = await parsePdfWithLlamaParse(req.file.path);

    return res.json({
      originalName: req.file.originalname,
      size: req.file.size,
      ...parseResult,
    });
  } catch (error) {
    console.error("LlamaParse demo failed:", getSafeLlamaError(error));
    return res.status(error.statusCode || 500).json({ error: getSafeLlamaError(error) });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {
      // Temporary upload cleanup is best-effort and should never leak document contents to logs.
    });
  }
});

app.post("/api/manual-order", async (req, res) => {
  if (isBoostBossSleeping()) {
    return res.status(403).json({
      error: "Grabbit is sleeping from 12:30am to 7am. Orders reopen at 7am.",
    });
  }

  const order = req.body;
  const promoApplied = hasFreeDeliveryPromo(order.promoCode);

  if (!order.customerName || !order.phone || !order.orderedFrom || !order.paymentMethod) {
    return res.status(400).json({ error: "Missing required order details." });
  }

  const manualOrder = {
    sessionId: `manual_${crypto.randomUUID()}`,
    paymentStatus: "manual-submitted",
    amountTotal: promoApplied ? 0 : 300,
    currency: "usd",
    customerName: order.customerName,
    phone: order.phone,
    orderedFrom: order.orderedFrom,
    promoCode: promoApplied ? `${order.promoCode}`.trim() : "",
    promoApplied,
    paymentMethod: order.paymentMethod,
    deliveryType: order.deliveryType,
    deliveryDetails: order.deliveryDetails || "",
    locationType: order.locationType,
    locationSummary: summarizeLocation(order),
    woodlandHillBuilding: order.woodlandHillBuilding || "",
    afterHoursDetails: order.afterHoursDetails || "",
    screenshotPath: order.screenshotPath || "",
    createdAt: new Date().toISOString(),
    loggedAt: new Date().toISOString(),
  };

  await upsertOrderStore(manualOrder);

  let emailNotificationSent = false;
  let pokeNotificationSent = false;

  try {
    emailNotificationSent = await sendOrderNotification(manualOrder);
  } catch (error) {
    console.error("Email notification failed:", error.message);
  }

  try {
    pokeNotificationSent = await sendPokeNotification(manualOrder);
  } catch (error) {
    console.error("Poke notification failed:", error.message);
  }

  return res.json({ ...manualOrder, emailNotificationSent, pokeNotificationSent });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT) || 3000;

if (missingEnvVars.length > 0) {
  console.warn(`Missing environment variables: ${missingEnvVars.join(", ")}`);
}

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Pequod AI is running at http://localhost:${port}`);
      console.log(dbPool ? "Using Postgres persistence." : "Using local file persistence.");
    });
  });
