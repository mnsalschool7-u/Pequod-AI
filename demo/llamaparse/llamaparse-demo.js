const form = document.querySelector("#parse-form");
const fileInput = document.querySelector("#document-file");
const dropZone = document.querySelector("#drop-zone");
const formError = document.querySelector("#form-error");
const fileStatus = document.querySelector("#file-status");
const parseStatus = document.querySelector("#parse-status");
const useCustomsIndex = document.querySelector("#use-customs-index");
const indexStatusMessage = document.querySelector("#index-status-message");
const workspace = document.querySelector("#workspace");
const pdfPreview = document.querySelector("#pdf-preview");
const pdfFrame = document.querySelector("#pdf-frame");
const sourcePanelLabel = document.querySelector("#source-panel-label");
const sourcePanelTitle = document.querySelector("#source-panel-title");
const sourceCallout = document.querySelector("#source-callout");
const sourceCalloutPage = document.querySelector("#source-callout-page");
const sourceCalloutText = document.querySelector("#source-callout-text");
const productVisualCard = document.querySelector(".product-visual-card");
const productVisualImage = document.querySelector("#product-visual-image");
const markdownOutput = document.querySelector("#markdown-output");
const sourceFile = document.querySelector("#source-file");
const pagesProcessed = document.querySelector("#pages-processed");
const outputFormat = document.querySelector("#output-format");
const devSubmitted = document.querySelector("#dev-submitted");
const devJobId = document.querySelector("#dev-job-id");
const devStatus = document.querySelector("#dev-status");
const devOutput = document.querySelector("#dev-output");
const devComplete = document.querySelector("#dev-complete");
const structuredCount = document.querySelector("#structured-count");
const recordTableBody = document.querySelector("#record-table-body");
const attentionList = document.querySelector("#attention-list");
const retrievalStatus = document.querySelector("#retrieval-status");
const profileList = document.querySelector("#profile-list");
const retrievalResults = document.querySelector("#retrieval-results");
const hsCodeResults = document.querySelector("#hs-code-results");
const steps = Array.from(document.querySelectorAll("#processing-steps li"));
const demoApiBaseUrl = "https://pequod-ai-parser-api.onrender.com";

let previewUrl = "";

const legacyParserHash = ["#parser", "output"].join(String.fromCharCode(45));

if (window.location.hash === legacyParserHash) {
  history.replaceState(null, "", "#parseroutput");
}

async function loadIndexStatus() {
  try {
    const response = await fetch(`${demoApiBaseUrl}/api/demo/llamaparse/index-status`);
    const status = await response.json();

    if (status.connected) {
      useCustomsIndex.disabled = false;
      useCustomsIndex.checked = true;
      indexStatusMessage.textContent = status.maskedIndexId
        ? `Connected server side index ${status.maskedIndexId}.`
        : "Public CBP CROSS ruling search is available.";
      return;
    }

    useCustomsIndex.disabled = true;
    useCustomsIndex.checked = false;
    indexStatusMessage.textContent = "Customs ruling search is unavailable right now.";
  } catch (_error) {
    useCustomsIndex.disabled = true;
    useCustomsIndex.checked = false;
    indexStatusMessage.textContent = "Customs index status is unavailable right now.";
  }
}

function setError(message = "") {
  formError.textContent = message;
  fileInput.setAttribute("aria-invalid", String(Boolean(message)));
}

function setStep(activeStep) {
  let activeSeen = false;

  steps.forEach((step) => {
    const isActive = step.dataset.step === activeStep;

    step.classList.toggle("is-active", isActive);
    const isFuture = step.classList.contains("is-future");
    const isComplete = !activeSeen && !isActive && Boolean(activeStep) && !isFuture;

    step.classList.toggle("is-complete", isComplete);

    if (isActive) {
      activeSeen = true;
    }
  });
}

function clearSteps() {
  steps.forEach((step) => {
    step.classList.remove("is-active", "is-complete");
  });
}

function setStatus(label, state = "idle") {
  parseStatus.textContent = label;
  parseStatus.classList.remove("idle", "success", "error");
  parseStatus.classList.add(state);
}

function isPdf(file) {
  return file && file.type === "application/pdf" && file.name.toLowerCase().endsWith(".pdf");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showPreview(file) {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  previewUrl = URL.createObjectURL(file);
  pdfFrame.src = previewUrl;
  pdfPreview.hidden = false;
  workspace.classList.remove("is-parsed");
  sourcePanelLabel.textContent = "Original document";
  sourcePanelTitle.textContent = "PDF upload";
  sourceCallout.hidden = true;
  productVisualCard.hidden = true;
  productVisualImage.removeAttribute("src");
  fileStatus.textContent = `${file.name} · ${formatBytes(file.size)}`;
}

function getPdfSearchText(text = "") {
  return `${text}`
    .replace(/Page\s+\d+/gi, "")
    .replace(/[^\w\s.]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 10)
    .join(" ");
}

function focusPdfSource(page, text = "") {
  if (!previewUrl || !page) {
    return;
  }

  const searchText = getPdfSearchText(text);
  const pageTarget = `${previewUrl}#page=${encodeURIComponent(page)}${searchText ? `&search=${encodeURIComponent(searchText)}` : ""}`;

  pdfFrame.src = pageTarget;
  pdfPreview.hidden = false;
  sourceCalloutPage.textContent = `Page ${page}`;
  sourceCalloutText.textContent = text || "Supporting source text selected.";
  sourceCallout.hidden = false;
  document.querySelector(".upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleFileSelection(file) {
  if (!file) {
    return;
  }

  if (!isPdf(file)) {
    setError("Please choose a PDF file for this demo.");
    fileInput.value = "";
    fileStatus.textContent = "Invalid file";
    return;
  }

  setError("");
  showPreview(file);
  clearSteps();
  setStatus("Ready", "idle");
  markdownOutput.textContent = "Ready to send this PDF to the live parser.";
  resetAnalysisPanels();
}

fileInput.addEventListener("change", () => {
  handleFileSelection(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];

  if (!file) {
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  handleFileSelection(file);
});

function updateFromResponse(data) {
  workspace.classList.add("is-parsed");
  sourcePanelLabel.textContent = "Source evidence";
  sourcePanelTitle.textContent = "PDF source";
  sourceFile.textContent = data.originalName || "Uploaded PDF";
  pagesProcessed.textContent = data.pagesProcessed ? String(data.pagesProcessed) : "Not available";
  outputFormat.textContent = data.outputFormat || "Not available";
  devSubmitted.textContent = data.submitted ? "Yes" : "No";
  devJobId.textContent = data.jobId || "Not available";
  devStatus.textContent = data.status || "Unknown";
  devOutput.textContent = data.outputFormat || "Not available";
  devComplete.textContent = data.completed ? "Yes" : "No";
  markdownOutput.textContent = data.markdown || "The parser returned no markdown output.";
  renderProductRecord(data.productRecord);
  renderAttention(data.productRecord);
  renderRetrievalProfile(data.retrievalProfile);
  renderRetrievalResults(data.customsRetrieval, data.productRecord);
  renderHsCodes(data.customsRetrieval);
  renderProductVisual(data);
}

function resetAnalysisPanels() {
  workspace.classList.remove("is-parsed");
  sourcePanelLabel.textContent = "Original document";
  sourcePanelTitle.textContent = "PDF upload";
  sourceCallout.hidden = true;
  structuredCount.textContent = "Ready";
  recordTableBody.innerHTML = `<tr><td colspan="4">Parse the selected PDF to extract document supported product facts.</td></tr>`;
  attentionList.innerHTML = "<li>Parse the selected PDF to identify additional classification inputs.</li>";
  retrievalStatus.textContent = "Ready";
  retrievalStatus.className = "status-chip idle";
  profileList.innerHTML = `<div><dt>Legal task</dt><dd>Waiting for document ingestion.</dd></div>`;
  retrievalResults.textContent = "Public customs ruling search will run after parsing.";
  hsCodeResults.textContent = "Parse a PDF to generate a candidate HTSUS classification.";
  productVisualCard.hidden = true;
  productVisualImage.removeAttribute("src");
}

function renderProductVisual(data) {
  const visual = data?.productVisual || {};
  const productName = data?.productRecord?.product_name || "product";

  if (visual.available && visual.url) {
    productVisualImage.src = visual.url;
    productVisualImage.alt = `${productName} product image`;
    productVisualCard.hidden = false;
    return;
  }

  productVisualCard.hidden = true;
  productVisualImage.removeAttribute("src");
}

function escapeHtml(value = "") {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "";
  }

  return value || "";
}

function renderProductRecord(record) {
  const fields = Array.isArray(record?.fields) ? record.fields : [];
  const extractedCount = fields.filter((field) => field.status === "Found").length;

  structuredCount.textContent = fields.length > 0 ? `${extractedCount} fields` : "No fields";

  if (fields.length === 0) {
    recordTableBody.innerHTML = `<tr><td colspan="4">No structured fields were returned.</td></tr>`;
    return;
  }

  recordTableBody.innerHTML = fields
    .map((field) => `
      <tr>
        <td>${escapeHtml(field.label)}</td>
        <td>${escapeHtml(formatValue(field.value) || "Missing")}</td>
        <td><span class="table-status ${escapeHtml(field.status.toLowerCase())}">${escapeHtml(field.status)}</span></td>
        <td>
          ${field.sourcePage ? `
            <details class="source-details" data-source-page="${escapeHtml(field.sourcePage)}" data-source-text="${escapeHtml(field.supportingText || "")}">
              <summary>View source</summary>
              <p>${escapeHtml(field.supportingText || "Source text unavailable")}</p>
            </details>
          ` : "None"}
        </td>
      </tr>
    `)
    .join("");
}

function renderAttention(record) {
  const missing = new Set(record?.missing_information || []);
  const flags = [
    ["Components", "Component breakdown"],
    ["Wattage", "Detailed electrical specifications"],
    ["Dimensions", "Dimensions"],
    ["Secondary materials", "Material composition"],
    ["Intended use", "Principal use evidence"],
    ["Base material", "Assembly information"],
  ];
  const applicable = Array.from(new Set(flags.filter(([field]) => missing.has(field)).map(([, label]) => label)));

  attentionList.innerHTML = applicable.length > 0
    ? applicable.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")
    : "<li>No additional classification inputs were flagged by the configured checklist.</li>";
}

function renderRetrievalProfile(profile) {
  if (!profile) {
    profileList.innerHTML = `<div><dt>Legal task</dt><dd>Waiting for document ingestion.</dd></div>`;
    return;
  }

  const rows = [
    ["Legal task", profile.legalTask],
    ["Product class", profile.productClass],
    ["Product concepts", profile.classificationKeywords],
    ["Primary material", profile.primaryMaterial],
    ["Electrical function", profile.electricalComponents],
    ["Intended use", profile.intendedUse],
    ["Origin", profile.countryOfOrigin],
    ["Retrieval", "CBP CROSS. Classification rulings prioritized."],
  ];

  profileList.innerHTML = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`)
    .join("") + `
      <div>
        <dt>Raw retrieval query</dt>
        <dd>
          <details class="source-details">
            <summary>View query</summary>
            <p>${escapeHtml(profile.query || "")}</p>
          </details>
        </dd>
      </div>
    `;
}

function getRelevanceScore(value) {
  const score = Number(value);

  return Number.isFinite(score) ? score : -1;
}

function getRankedRetrievalResults(retrieval) {
  const results = Array.isArray(retrieval?.results) ? retrieval.results : [];

  return results
    .map((result, index) => ({
      ...result,
      originalIndex: index,
      relevanceScore: getRelevanceScore(result.score),
    }))
    .sort((first, second) => {
      if (second.relevanceScore !== first.relevanceScore) {
        return second.relevanceScore - first.relevanceScore;
      }

      return first.originalIndex - second.originalIndex;
    });
}

function getClassificationResults(results = []) {
  return results.filter((result) => result.issueGroup === "Classification precedents" || /classification|tariff/i.test(result.legalIssue || result.categories || ""));
}

function getRelatedResults(results = []) {
  return results.filter((result) => !getClassificationResults([result]).length);
}

function renderPrecedentComparison(result, record = {}) {
  const content = `${result?.title || ""} ${result?.content || ""}`.toLowerCase();
  const rows = [
    ["Salt body", record.primary_material, /salt/i.test(content) ? "Natural salt block or salt lamp" : null, /salt/i.test(content) ? "Match" : "Unclear"],
    ["Lighting", record.light_source, /color.?changing.*led|led.*color.?changing/i.test(content) ? "Color changing LED" : /\bled\b/i.test(content) ? "LED lighting" : null, /\bled\b/i.test(content) ? "Match" : "Unclear"],
    ["Power", record.power_source || record.voltage, /\busb\b/i.test(content) ? "USB or electrical" : /electric|powered|bulb/i.test(content) ? "Electrical" : null, /usb|electric|powered|bulb/i.test(content) ? "Partial" : "Unclear"],
    ["Base", record.base_material, /plastic base/i.test(content) ? "Plastic base" : /base/i.test(content) ? "Base described" : null, /base/i.test(content) ? "Review" : "Unclear"],
    ["Origin", record.country_of_origin, /china/i.test(content) ? "China" : null, /china/i.test(content) ? "Different or not controlling" : "Unclear"],
  ];

  return `
    <details class="precedent-comparison">
      <summary>View precedent comparison</summary>
      <table>
        <thead>
          <tr>
            <th>Attribute</th>
            <th>Uploaded product</th>
            <th>CBP precedent</th>
            <th>Relation</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([attribute, product, precedent, relation]) => `
            <tr>
              <td>${escapeHtml(attribute)}</td>
              <td>${escapeHtml(formatValue(product) || "Missing")}</td>
              <td>${escapeHtml(precedent || "Not clear")}</td>
              <td>${escapeHtml(relation)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p>Potentially relevant precedent. Requires human classification review.</p>
    </details>
  `;
}

function renderRetrievalResults(retrieval, record = {}) {
  if (!retrieval?.connected) {
    retrievalStatus.textContent = "Unavailable";
    retrievalStatus.className = "status-chip idle";
    retrievalResults.textContent = retrieval?.message || "Customs ruling search is unavailable right now.";
    return;
  }

  retrievalStatus.textContent = retrieval.provider || "Connected";
  retrievalStatus.className = "status-chip success";

  const rankedResults = getRankedRetrievalResults(retrieval);

  if (rankedResults.length === 0) {
    retrievalResults.textContent = retrieval.message || "Customs ruling search returned no matching documents.";
    return;
  }

  const classificationResults = getClassificationResults(rankedResults);
  const relatedResults = getRelatedResults(rankedResults);
  const renderCard = (result, index, includeComparison = false) => `
      <article class="retrieval-card">
        <span>Rank ${index + 1} | ${escapeHtml(result.rulingNumber || `Result ${index + 1}`)}</span>
        <h4>${escapeHtml(result.title || `Result ${index + 1}`)}</h4>
        <p>${escapeHtml(result.content)}</p>
        <small>
          Legal issue: ${escapeHtml(result.legalIssue || "Related customs issue")}
          | Precedent relevance: ${escapeHtml(result.relevanceLabel || "Related")}
          ${result.rulingDate ? ` | Date: ${escapeHtml(result.rulingDate.slice(0, 10))}` : ""}
          ${Array.isArray(result.tariffs) && result.tariffs.length > 0 ? ` | HTSUS noted: ${escapeHtml(result.tariffs.join(", "))}` : ""}
        </small>
        <small>${escapeHtml(result.scoreBasis || "")}</small>
        ${result.url ? `<a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Open CBP ruling</a>` : ""}
        ${includeComparison ? renderPrecedentComparison(result, record) : ""}
      </article>
    `;

  retrievalResults.innerHTML = `
    ${classificationResults.length > 0 ? `
      <div class="retrieval-group">
        <h4>Classification precedents</h4>
        ${classificationResults.map((result, index) => renderCard(result, index, index === 0)).join("")}
      </div>
    ` : ""}
    ${relatedResults.length > 0 ? `
      <div class="retrieval-group">
        <h4>Related rulings</h4>
        ${relatedResults.map((result, index) => renderCard(result, index)).join("")}
      </div>
    ` : ""}
  `;
}

function collectHsCodes(retrieval) {
  const results = getRankedRetrievalResults(retrieval);
  const codes = new Map();

  results.forEach((result, resultIndex) => {
    const tariffs = Array.isArray(result.tariffs) ? result.tariffs : [];

    tariffs.forEach((code) => {
      const normalizedCode = `${code}`.trim();

      if (!normalizedCode || /^99/i.test(normalizedCode)) {
        return;
      }

      if (!codes.has(normalizedCode)) {
        codes.set(normalizedCode, {
          code: normalizedCode,
          sources: [],
        });
      }

      codes.get(normalizedCode).sources.push({
        rulingNumber: result.rulingNumber || "Not available",
        title: result.title || "Retrieved customs ruling",
        score: result.score ?? "Not available",
        relevanceLabel: result.relevanceLabel || "Related",
        numericScore: Number(result.score) || 0,
        resultIndex,
        url: result.url || "",
      });
    });
  });

  return Array.from(codes.values());
}

function getRankedHsCodes(codes) {
  return codes
    .map((item) => {
      const bestSource = item.sources
        .slice()
        .sort((first, second) => {
          if (second.numericScore !== first.numericScore) {
            return second.numericScore - first.numericScore;
          }

          return first.resultIndex - second.resultIndex;
        })[0];

      return {
        ...item,
        bestSource,
        bestScore: bestSource?.numericScore || 0,
        bestRank: bestSource?.resultIndex ?? 999,
      };
    })
    .sort((first, second) => {
      if (second.bestScore !== first.bestScore) {
        return second.bestScore - first.bestScore;
      }

      return first.bestRank - second.bestRank;
    });
}

function renderHsCodes(retrieval) {
  const codes = collectHsCodes(retrieval);

  if (!retrieval?.connected) {
    hsCodeResults.textContent = "Customs ruling search is unavailable right now.";
    return;
  }

  if (codes.length === 0) {
    hsCodeResults.textContent = "No candidate HTSUS classification could be generated for this product.";
    return;
  }

  const rankedCodes = getRankedHsCodes(codes);
  const suggested = rankedCodes[0];
  const otherCodes = rankedCodes.slice(1);

  hsCodeResults.innerHTML = `
    <article class="hs-code-card hs-code-card-primary">
      <span>Rank 1 | Candidate HTSUS Classification</span>
      <strong>${escapeHtml(suggested.code)}</strong>
      <p>Supported by retrieved CBP precedent. Review required before filing.</p>
      <span>Supporting precedent</span>
      <ul>
        ${suggested.sources.map((source) => `
          <li>
            ${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.rulingNumber)}</a>` : escapeHtml(source.rulingNumber)}
            <small>${escapeHtml(source.title)} | Legal issue: Tariff classification</small>
          </li>
        `).join("")}
      </ul>
      ${otherCodes.length > 0 ? `
        <div class="hs-code-ranked-list">
          ${otherCodes.map((item, index) => `
            <div>
              <span>Rank ${index + 2}</span>
              <strong>${escapeHtml(item.code)}</strong>
              <small>Precedent relevance: ${escapeHtml(item.bestSource?.relevanceLabel || "Related")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];

  if (!isPdf(file)) {
    setError("Please upload a PDF before parsing.");
    fileInput.focus();
    return;
  }

  const body = new FormData();
  body.append("document", file);
  body.append("useCustomsIndex", String(useCustomsIndex.checked && !useCustomsIndex.disabled));

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setError("");
  setStatus("Uploading", "idle");
  setStep("uploading");
  markdownOutput.textContent = "Uploading PDF to the Pequod server. The server will submit it to the live parser.";

  try {
    setStep("submitting");
    setStatus("Submitting", "idle");

    const response = await fetch(`${demoApiBaseUrl}/api/demo/llamaparse`, {
      method: "POST",
      body,
    });

    setStep("parsing");
    setStatus("Parsing", "idle");

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "The document could not be parsed.");
    }

    setStep("extracting");
    setStatus("Extracting", "idle");
    setStep("validating");
    setStatus("Validating", "idle");
    setStep("profile");
    setStatus("Retrieval profile", "idle");
    setStep("complete");
    setStatus("Complete", "success");
    updateFromResponse(data);
  } catch (error) {
    setStatus("Error", "error");
    setError(error.message || "The document could not be parsed.");
    markdownOutput.textContent = "No parsed output was returned. Check the error above and try again.";
    devStatus.textContent = "Failed";
  } finally {
    submitButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
});

productVisualImage.addEventListener("error", () => {
  productVisualCard.hidden = true;
  productVisualImage.removeAttribute("src");
});

recordTableBody.addEventListener("toggle", (event) => {
  const details = event.target;

  if (!(details instanceof HTMLDetailsElement) || !details.classList.contains("source-details") || !details.open) {
    return;
  }

  focusPdfSource(details.dataset.sourcePage, details.dataset.sourceText || details.textContent || "");
}, true);

loadIndexStatus();
