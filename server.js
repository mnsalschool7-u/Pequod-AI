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

function getProductVisual(result) {
  const images = Array.isArray(result?.images_content_metadata?.images)
    ? result.images_content_metadata.images
    : [];
  const candidates = images
    .filter((image) => image?.presigned_url && image.category !== "screenshot")
    .map((image) => {
      const area = Number(image?.bbox?.w || 0) * Number(image?.bbox?.h || 0);
      const categoryScore = image.category === "layout" ? 3 : image.category === "embedded" ? 2 : 1;

      return {
        image,
        area,
        categoryScore,
      };
    })
    .sort((first, second) => {
      if (second.categoryScore !== first.categoryScore) {
        return second.categoryScore - first.categoryScore;
      }

      if (second.area !== first.area) {
        return second.area - first.area;
      }

      return Number(first.image.index || 0) - Number(second.image.index || 0);
    });
  const selectedImage = candidates[0]?.image || null;

  if (!selectedImage) {
    return {
      available: false,
      status: images.length > 0 ? "Images returned, but no cropped product image was available." : "No product image returned by parser.",
      imageCount: images.length,
      source: "LlamaParse image extraction",
      url: null,
      filename: null,
      contentType: null,
      category: null,
    };
  }

  return {
    available: true,
    status: selectedImage.category === "layout" ? "Cropped product image extracted" : "Embedded product image extracted",
    imageCount: images.length,
    source: "LlamaParse image extraction",
    url: selectedImage.presigned_url,
    filename: selectedImage.filename || "Extracted image",
    contentType: selectedImage.content_type || null,
    category: selectedImage.category || null,
  };
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
  if (value == null) {
    return "";
  }

  return `${value}`.replace(/\s+/g, " ").trim();
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function getPageLines(pages) {
  const longDashPattern = /[\u2013\u2014]/g;

  return pages.flatMap((page) => `${page.markdown || ""}`
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean)
    .map((line) => ({
      page: page.pageNumber,
      text: line.replace(longDashPattern, "-"),
    })));
}

function stripMarkdownBullet(value = "") {
  return cleanText(value.replace(/^[*•\-\s]+/, "").replace(/[\u2013\u2014]/g, "-"));
}

function normalizeFieldValue(value = "") {
  return stripMarkdownBullet(value)
    .replace(/\s+PK$/i, "")
    .replace(/\bLB\b/g, "lb")
    .replace(/\bLBS\b/g, "lb")
    .replace(/\s+/g, " ")
    .trim();
}

function findLineEvidence(lines, patterns) {
  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line.text))) {
      return {
        page: line.page,
        excerpt: line.text.slice(0, 220),
        line: line.text,
      };
    }
  }

  return null;
}

function findLabeledLineValue(lines, labels, valuePattern = /(.+)/i) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`^(?:${labelPattern})\\s*[:|]\\s*(.+)$`, "i");

  for (const line of lines) {
    const labelMatch = line.text.match(pattern);

    if (!labelMatch?.[1]) {
      continue;
    }

    const valueMatch = labelMatch[1].match(valuePattern);
    const value = normalizeFieldValue(valueMatch?.[1] || labelMatch[1]);

    if (value) {
      return {
        value,
        evidence: {
          page: line.page,
          excerpt: line.text.slice(0, 220),
        },
      };
    }
  }

  return {
    value: null,
    evidence: null,
  };
}

function findFirstLineValue(lines, patterns, normalizer = normalizeFieldValue) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.text.match(pattern);

      if (match?.[1]) {
        const value = normalizer(match[1]);

        if (value) {
          return {
            value,
            evidence: {
              page: line.page,
              excerpt: line.text.slice(0, 220),
            },
          };
        }
      }
    }
  }

  return {
    value: null,
    evidence: null,
  };
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
  const displayStatus = hasValue ? status === "Extracted" ? "Found" : status : "Missing";

  return {
    key,
    label: productFields.find(([fieldKey]) => fieldKey === key)?.[1] || key,
    value: hasValue ? value : isArray ? [] : null,
    sourcePage: hasValue ? evidence?.page || null : null,
    supportingText: hasValue ? evidence?.excerpt || "" : "",
    status: displayStatus,
  };
}

function extractProductRecord(pages) {
  const markdown = pages.map((page) => page.markdown || "").join("\n");
  const text = cleanText(markdown);
  const lower = text.toLowerCase();
  const lines = getPageLines(pages);

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

  const labeledProductName = findLabeledLineValue(lines, ["Product name", "Item name"]);
  const productTypeName = findLabeledLineValue(lines, ["Product type"]);
  const titleProductName = findFirstLineValue(lines, [
    /^([A-Za-z0-9][A-Za-z0-9 &,'()/-]{2,90}\blamp\b)$/i,
    /^([A-Za-z0-9][A-Za-z0-9 &,'()/-]{2,90}\bsalt\b[A-Za-z0-9 &,'()/-]{0,60})$/i,
  ]);
  const productName = labeledProductName.value || titleProductName.value || productTypeName.value || null;
  const productNameEvidence = labeledProductName.evidence || titleProductName.evidence || productTypeName.evidence || evidence.product_name;

  const components = uniqueValues([
    /natural salt|salt crystal|himalayan/i.test(text) ? "Natural salt body" : "",
    /color.?changing led|led/i.test(text) ? "Color changing LED" : "",
    /\busb\b/i.test(text) ? "USB power connection" : "",
    lower.includes("cord") ? "Electrical cord" : "",
    lower.includes("socket") ? "Socket" : "",
    lower.includes("switch") ? "Switch" : "",
    lower.includes("bulb") ? "Bulb" : "",
    lower.includes("base") ? "Base" : "",
  ]);

  const secondaryMaterials = uniqueValues([
    lower.includes("plastic") ? "Plastic" : "",
    lower.includes("metal") ? "Metal" : "",
    /wood|wooden/i.test(text) ? "Wood" : "",
  ]);

  const voltageResult = findLabeledLineValue(lines, ["Voltage"], /(\b\d{1,3}\s?v(?:olts?)?\b)/i);
  const powerLine = findLabeledLineValue(lines, ["Power"]);
  const voltageFromPower = findFirstLineValue(lines, [/power\s*[:|]\s*.*?(\b\d{1,3}\s?v(?:olts?)?\b)/i]);
  const wattageResult = findLabeledLineValue(lines, ["Wattage", "Watts"], /(\b\d{1,4}\s?w(?:atts?)?\b)/i);
  const dimensionsResult = findLabeledLineValue(lines, ["Dimensions", "Size"], /(\b\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(?:inches|inch|in|cm|mm)?\b)/i);
  const weightResult = findLabeledLineValue(lines, ["Weight"], /((?:approx\.?\s*)?\d+(?:\.\d+)?\s*(?:lb|lbs|kg|g)\b)/i);
  const countryResult = findLabeledLineValue(lines, ["Country of origin", "Origin"], /([A-Za-z ]{2,60})(?:\s+[A-Z]{2})?$/i);
  const modelResult = findLabeledLineValue(lines, ["Model", "SKU", "Item no.", "Item no", "Item number"]);
  const materialResult = findLabeledLineValue(lines, ["Primary material", "Material"]);
  const lightSourceResult = findLabeledLineValue(lines, ["Light source"]);

  const primaryMaterial = materialResult.value ||
    (/natural himalayan pink salt/i.test(text) ? "Natural Himalayan Pink Salt" : /natural salt crystal|himalayan|rock salt|salt crystal/i.test(text) ? "Natural salt" : null);
  const primaryMaterialEvidence = materialResult.evidence || findLineEvidence(lines, [/natural himalayan pink salt/i, /natural salt crystal/i, /himalayan/i]);
  const baseMaterialEvidence = findLineEvidence(lines, [/wooden base/i, /wood base/i, /plastic base/i, /base material/i]);
  const baseMaterial = /wooden base|wood base/i.test(baseMaterialEvidence?.line || "") ? "Wood" :
    /plastic base/i.test(baseMaterialEvidence?.line || "") ? "Plastic" : null;
  const lightSource = lightSourceResult.value ||
    (/color.?changing led/i.test(text) ? "Color changing LED" : /\bled\b/i.test(text) ? "LED" : /replaceable bulb|bulb/i.test(text) ? "Bulb" : null);
  const lightSourceEvidence = lightSourceResult.evidence || findLineEvidence(lines, [/color.?changing led/i, /\bled\b/i, /bulb/i]);
  const powerSource = /\busb\b/i.test(powerLine.value || text) ? "USB" : /electric|cord|plug/i.test(text) ? "Electrical" : null;
  const powerSourceEvidence = powerLine.evidence || findLineEvidence(lines, [/\busb\b/i, /power source/i, /electric/i]);
  const voltage = voltageResult.value || voltageFromPower.value || null;
  const voltageEvidence = voltageResult.evidence || voltageFromPower.evidence || null;
  const wattage = wattageResult.value || null;
  const dimensions = dimensionsResult.value || null;
  const weight = weightResult.value ? normalizeFieldValue(weightResult.value) : null;
  const country = countryResult.value || null;
  const perfectForIndex = lines.findIndex((line) => /^Perfect For:?$/i.test(line.text) || /^Perfect For:/i.test(line.text));
  const intendedUseLines = perfectForIndex >= 0
    ? lines
      .slice(perfectForIndex + 1)
      .filter((line) => !/please note|product details|company|origin|weight|size|power|light source|material/i.test(line.text))
      .filter((line) => /bedroom|night light|desk|office|meditation|yoga|ambient lighting|decor|gift/i.test(line.text))
      .slice(0, 5)
    : lines
      .filter((line) => /^\*?\s*(Relaxing Ambient Light|Stylish Home Decor|Perfect Gift Choice)/i.test(line.text))
      .slice(0, 4);
  const intendedUseEvidence = intendedUseLines[0]
    ? {
      page: intendedUseLines[0].page,
      excerpt: intendedUseLines.map((line) => line.text).join(" ").slice(0, 220),
    }
    : findLineEvidence(lines, [/Perfect For/i, /ambient lighting/i, /bedroom/i, /meditation/i, /desk/i, /home decor/i]);
  const intendedUse = intendedUseLines.length > 0
    ? uniqueValues(intendedUseLines.map((line) => normalizeFieldValue(line.text.replace(/^Perfect For:?/i, "")))).join("; ")
    : null;
  const descriptionEvidence = findLineEvidence(lines, [/Create a warm/i, /Made from/i, /This lamp/i]);
  const description = findFirstMatch(markdown, [/description\s*[:|]\s*([^\n\r]+)/i]) ||
    (descriptionEvidence ? normalizeFieldValue(descriptionEvidence.line).slice(0, 180) : null);
  const documentType = /product details|product information|specification|product sheet/i.test(text) ? "Product information document" : null;

  const fields = [
    makeField("document_type", documentType, findLineEvidence(lines, [/product details/i, /product information/i, /specification/i, /product sheet/i])),
    makeField("product_name", productName, productNameEvidence),
    makeField("model_number", modelResult.value, modelResult.evidence),
    makeField("product_description", description, evidence.product_description),
    makeField("primary_material", primaryMaterial, primaryMaterialEvidence),
    makeField("secondary_materials", secondaryMaterials, findLineEvidence(lines, [/plastic/i, /metal/i, /wood/i])),
    makeField("components", components, evidence.components),
    makeField("base_material", baseMaterial, baseMaterialEvidence),
    makeField("light_source", lightSource, lightSourceEvidence),
    makeField("power_source", powerSource, powerSourceEvidence),
    makeField("voltage", voltage, voltageEvidence),
    makeField("wattage", wattage, wattageResult.evidence),
    makeField("dimensions", dimensions, dimensionsResult.evidence),
    makeField("weight", weight, weightResult.evidence),
    makeField("intended_use", intendedUse, intendedUseEvidence),
    makeField("country_of_origin", country, countryResult.evidence),
  ];

  const missingInformation = fields.filter((field) => field.status === "Missing").map((field) => field.label);

  return {
    document_type: documentType,
    product_name: productName,
    model_number: modelResult.value,
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
    haystack.includes("color changing") || haystack.includes("color-changing") ? "color changing salt lamp" : "",
    haystack.includes("lamp") ? "electric decorative lamp" : "",
    haystack.includes("salt") ? "natural mineral lamp" : "",
    haystack.includes("himalayan") && haystack.includes("salt") ? "himalayan salt lamp" : "",
    haystack.includes("usb") ? "USB powered lighting" : "",
    haystack.includes("led") ? "LED lighting" : "",
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
    legalTask: "Tariff classification",
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

function getCbpSearchTerms(profile) {
  const query = cleanText(profile?.query || "");
  const keywords = Array.isArray(profile?.classificationKeywords) ? profile.classificationKeywords : [];
  const haystack = [
    query,
    profile?.productClass,
    profile?.primaryMaterial,
    profile?.principalFunction,
    profile?.intendedUse,
    ...keywords,
  ].filter(Boolean).join(" ").toLowerCase();
  const focusedTerms = [
    haystack.includes("color") && haystack.includes("salt") && haystack.includes("lamp")
      ? "color changing salt lamp"
      : "",
    haystack.includes("himalayan") && haystack.includes("salt") && haystack.includes("lamp")
      ? "Himalayan salt lamp"
      : "",
    haystack.includes("salt") && haystack.includes("lamp") ? "salt lamp" : "",
    haystack.includes("decorative") && haystack.includes("lamp") ? "decorative lamp" : "",
    haystack.includes("electric") && haystack.includes("lamp") ? "electric lamp" : "",
  ];
  const terms = uniqueValues([
    ...focusedTerms,
    profile?.productClass,
    ...keywords,
    query,
  ]).filter((term) => term && term.length >= 4);

  return terms.slice(0, 5);
}

function getMatchKeywords(profile) {
  const stopWords = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "good",
    "goods",
    "product",
    "class",
    "not",
    "stated",
    "household",
  ]);
  const source = [
    profile?.query,
    profile?.productClass,
    profile?.principalFunction,
    profile?.primaryMaterial,
    profile?.intendedUse,
    ...(profile?.classificationKeywords || []),
  ].filter(Boolean).join(" ").toLowerCase();

  return uniqueValues(
    source
      .split(/[^a-z0-9]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length > 3 && !stopWords.has(word))
  ).slice(0, 18);
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`CBP CROSS request failed with status ${response.status}.`);
      error.statusCode = response.status;
      throw error;
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function scoreCbpRuling(ruling, detailText, keywords, rank) {
  const haystack = cleanText([
    ruling?.rulingNumber,
    ruling?.subject,
    ruling?.categories,
    ...(ruling?.tariffs || []),
    detailText,
  ].filter(Boolean).join(" ")).toLowerCase();
  const categories = cleanText(ruling?.categories || "").toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  const isClassification = /classification|htsus|tariff/.test(categories) || /tariff classification|applicable subheading|classified under|htsus/i.test(detailText);
  const isCountry = /country|origin|marking/.test(categories) || /country of origin|origin determination|marking/i.test(detailText);
  const legalIssueScore = isClassification ? 42 : isCountry ? -28 : 0;
  const rankScore = Math.max(0, 18 - rank * 3);
  const keywordScore = Math.min(30, matchedKeywords.length * 4);
  const exactSaltLampScore = haystack.includes("salt lamp") ? 14 : 0;
  const colorLedScore = /color.?changing/.test(haystack) && /\bled\b/.test(haystack) ? 18 : 0;
  const tariffScore = Array.isArray(ruling?.tariffs) && ruling.tariffs.length > 0 ? 14 : 0;
  const relevanceScore = Math.max(1, legalIssueScore + rankScore + keywordScore + exactSaltLampScore + colorLedScore + tariffScore);
  const relevanceLabel = relevanceScore >= 82 ? "High" : relevanceScore >= 54 ? "Medium" : "Related";

  return {
    relevanceScore,
    relevanceLabel,
    legalIssue: isClassification ? "Tariff classification" : isCountry ? "Country of origin" : "Related customs issue",
    issueGroup: isClassification ? "Classification precedents" : "Related rulings",
    matchedKeywords,
  };
}

async function retrievePublicCbpPrecedents(profile) {
  const terms = getCbpSearchTerms(profile);
  const keywords = getMatchKeywords(profile);
  const seen = new Map();

  for (const term of terms) {
    const url = `https://rulings.cbp.gov/api/search?term=${encodeURIComponent(term)}&from=0&size=5`;
    const data = await fetchJsonWithTimeout(url);

    for (const ruling of data?.rulings || []) {
      if (!ruling?.rulingNumber || seen.has(ruling.rulingNumber)) {
        continue;
      }

      seen.set(ruling.rulingNumber, ruling);
    }
  }

  const rulings = Array.from(seen.values()).slice(0, 10);
  const results = [];

  for (const [index, ruling] of rulings.entries()) {
    let detailText = "";

    try {
      const detail = await fetchJsonWithTimeout(
        `https://rulings.cbp.gov/api/ruling/${encodeURIComponent(ruling.rulingNumber)}`,
        12000
      );
      detailText = cleanText(detail?.text || "");
    } catch (_error) {
      detailText = cleanText(ruling.subject || "");
    }

    const score = scoreCbpRuling(ruling, detailText, keywords, index);
    results.push({
      source: "CBP CROSS public search",
      rulingNumber: ruling.rulingNumber,
      title: ruling.subject || `CBP ruling ${ruling.rulingNumber}`,
      rulingDate: ruling.rulingDate || null,
      categories: ruling.categories || null,
      tariffs: ruling.tariffs || [],
      url: `https://rulings.cbp.gov/ruling/${ruling.rulingNumber.toLowerCase()}`,
      content: detailText.slice(0, 900),
      score: score.relevanceScore,
      relevanceLabel: score.relevanceLabel,
      legalIssue: score.legalIssue,
      issueGroup: score.issueGroup,
      scoreLabel: "Precedent relevance",
      scoreBasis: score.matchedKeywords.length > 0
        ? `Matched terms: ${score.matchedKeywords.join(", ")}`
        : "Based on legal issue, product similarity, and ruling metadata.",
      rerankScore: null,
      metadata: {
        source: "CBP CROSS",
        rulingNumber: ruling.rulingNumber,
      },
      staticFields: null,
    });
  }

  return {
    connected: true,
    enabledForRun: true,
    provider: "CBP CROSS public search",
    indexId: null,
    query: profile.query,
    legalTask: profile.legalTask,
    results: results
      .sort((first, second) => Number(second.score || 0) - Number(first.score || 0))
      .slice(0, 6),
    message: results.length > 0
      ? "Public CBP CROSS retrieval completed."
      : "Public CBP CROSS search returned no matching rulings.",
  };
}

async function retrieveCustomsPrecedents(client, profile, useCustomsIndex = true) {
  const indexId = process.env.LLAMA_CLOUD_INDEX_ID || "";
  const maskedIndexId = indexId ? `${indexId.slice(0, 7)}...${indexId.slice(-4)}` : null;

  if (!useCustomsIndex) {
    return {
      connected: Boolean(indexId),
      enabledForRun: false,
      indexId: maskedIndexId,
      query: profile.query,
      results: [],
      message: "Customs ruling index search was not enabled for this run.",
    };
  }

  if (!indexId) {
    return retrievePublicCbpPrecedents(profile);
  }

  const response = await client.beta.retrieval.retrieve({
    index_id: indexId,
    query: profile.query,
    top_k: 5,
  });

  return {
    connected: true,
    enabledForRun: true,
    provider: "LlamaCloud Index",
    indexId: maskedIndexId,
    query: profile.query,
    results: (response?.results || []).map((result) => ({
      source: "LlamaCloud Index",
      content: cleanText(result.content || "").slice(0, 900),
      score: result.score ?? null,
      scoreLabel: "Index similarity score",
      scoreBasis: "Returned by LlamaCloud Index retrieval.",
      rerankScore: result.rerank_score ?? null,
      metadata: result.metadata || null,
      staticFields: result.static_fields || null,
    })),
    message: "Customs ruling index retrieval completed.",
  };
}

function getCustomsIndexStatus() {
  const indexId = process.env.LLAMA_CLOUD_INDEX_ID || "";

  return {
    connected: true,
    maskedIndexId: indexId ? `${indexId.slice(0, 7)}...${indexId.slice(-4)}` : null,
    source: indexId ? "LLAMA_CLOUD_INDEX_ID" : "CBP CROSS public search",
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

async function parsePdfWithLlamaParse(filePath, options = {}) {
  if (!process.env.LLAMA_CLOUD_API_KEY) {
    const error = new Error("Document parser is not configured on the server.");
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
        output_options: { images_to_save: ["layout", "embedded"] },
        expand: ["markdown", "images_content_metadata"],
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
  const productVisual = getProductVisual(result);
  const productRecord = extractProductRecord(pages);
  const retrievalProfile = buildRetrievalProfile(productRecord);
  let customsRetrieval;

  try {
    customsRetrieval = await retrieveCustomsPrecedents(client, retrievalProfile, options.useCustomsIndex);
  } catch (error) {
    console.error("Customs retrieval skipped:", getSafeLlamaError(error));
    customsRetrieval = {
      connected: Boolean(process.env.LLAMA_CLOUD_INDEX_ID),
      enabledForRun: Boolean(options.useCustomsIndex),
      indexId: process.env.LLAMA_CLOUD_INDEX_ID
        ? `${process.env.LLAMA_CLOUD_INDEX_ID.slice(0, 7)}...${process.env.LLAMA_CLOUD_INDEX_ID.slice(-4)}`
        : null,
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
    productVisual,
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

// Allow the static Pequod site to call the separate parser service safely.
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
app.get("/api/demo/llamaparse/index-status", (_req, res) => {
  return res.json(getCustomsIndexStatus());
});

app.post("/api/demo/llamaparse", llamaParseUpload.single("document"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload a PDF document." });
  }

  try {
    const parseResult = await parsePdfWithLlamaParse(req.file.path, {
      useCustomsIndex: req.body?.useCustomsIndex === "true",
    });

    return res.json({
      originalName: req.file.originalname,
      size: req.file.size,
      customsIndex: getCustomsIndexStatus(),
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
