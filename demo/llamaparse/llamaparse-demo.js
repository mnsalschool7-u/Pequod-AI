const form = document.querySelector("#parse-form");
const fileInput = document.querySelector("#document-file");
const dropZone = document.querySelector("#drop-zone");
const formError = document.querySelector("#form-error");
const fileStatus = document.querySelector("#file-status");
const parseStatus = document.querySelector("#parse-status");
const useCustomsIndex = document.querySelector("#use-customs-index");
const indexStatusMessage = document.querySelector("#index-status-message");
const pdfPreview = document.querySelector("#pdf-preview");
const pdfFrame = document.querySelector("#pdf-frame");
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
  fileStatus.textContent = `${file.name} · ${formatBytes(file.size)}`;
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
  renderRetrievalResults(data.customsRetrieval);
  renderHsCodes(data.customsRetrieval);
}

function resetAnalysisPanels() {
  structuredCount.textContent = "Ready";
  recordTableBody.innerHTML = `<tr><td colspan="5">Parse the selected PDF to extract document supported product facts.</td></tr>`;
  attentionList.innerHTML = "<li>Parse the selected PDF to identify missing classification information.</li>";
  retrievalStatus.textContent = "Ready";
  retrievalStatus.className = "status-chip idle";
  profileList.innerHTML = `<div><dt>Product class</dt><dd>Waiting for document ingestion.</dd></div>`;
  retrievalResults.textContent = "Public customs ruling search will run after parsing.";
  hsCodeResults.textContent = "Parse a PDF to see HS codes cited in retrieved customs rulings.";
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
    return value.length > 0 ? value.join(", ") : "Not stated";
  }

  return value || "Not stated";
}

function renderProductRecord(record) {
  const fields = Array.isArray(record?.fields) ? record.fields : [];
  const extractedCount = fields.filter((field) => field.status === "Extracted").length;

  structuredCount.textContent = fields.length > 0 ? `${extractedCount} fields` : "No fields";

  if (fields.length === 0) {
    recordTableBody.innerHTML = `<tr><td colspan="5">No structured fields were returned.</td></tr>`;
    return;
  }

  recordTableBody.innerHTML = fields
    .map((field) => `
      <tr>
        <td>${escapeHtml(field.label)}</td>
        <td>${escapeHtml(formatValue(field.value))}</td>
        <td>${escapeHtml(field.sourcePage || "Not available")}</td>
        <td>${escapeHtml(field.supportingText || "Not stated in document")}</td>
        <td><span class="table-status ${escapeHtml(field.status.toLowerCase())}">${escapeHtml(field.status)}</span></td>
      </tr>
    `)
    .join("");
}

function renderAttention(record) {
  const missing = new Set(record?.missing_information || []);
  const flags = [
    ["Intended use", "Missing intended use"],
    ["Country of origin", "Missing country of origin"],
    ["Primary material", "Missing material composition"],
    ["Components", "Missing component breakdown"],
    ["Voltage", "Missing electrical specifications"],
    ["Wattage", "Missing electrical specifications"],
    ["Dimensions", "Missing dimensions"],
    ["Weight", "Missing component values"],
  ];
  const applicable = Array.from(new Set(flags.filter(([field]) => missing.has(field)).map(([, label]) => label)));

  attentionList.innerHTML = applicable.length > 0
    ? applicable.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")
    : "<li>No missing classification fields were detected from the configured checklist.</li>";
}

function renderRetrievalProfile(profile) {
  if (!profile) {
    profileList.innerHTML = `<div><dt>Product class</dt><dd>Waiting for document ingestion.</dd></div>`;
    return;
  }

  const rows = [
    ["Product class", profile.productClass],
    ["Principal function", profile.principalFunction],
    ["Primary material", profile.primaryMaterial],
    ["Secondary materials", profile.secondaryMaterials],
    ["Electrical components", profile.electricalComponents],
    ["Intended use", profile.intendedUse],
    ["Country of origin", profile.countryOfOrigin],
    ["Classification keywords", profile.classificationKeywords],
    ["Retrieval query", profile.query],
  ];

  profileList.innerHTML = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`)
    .join("");
}

function renderRetrievalResults(retrieval) {
  if (!retrieval?.connected) {
    retrievalStatus.textContent = "Unavailable";
    retrievalStatus.className = "status-chip idle";
    retrievalResults.textContent = retrieval?.message || "Customs ruling search is unavailable right now.";
    return;
  }

  retrievalStatus.textContent = retrieval.provider || "Connected";
  retrievalStatus.className = "status-chip success";

  if (!Array.isArray(retrieval.results) || retrieval.results.length === 0) {
    retrievalResults.textContent = retrieval.message || "Customs ruling search returned no matching documents.";
    return;
  }

  retrievalResults.innerHTML = retrieval.results
    .map((result, index) => `
      <article class="retrieval-card">
        <span>${escapeHtml(result.rulingNumber || `Result ${index + 1}`)}</span>
        <h4>${escapeHtml(result.title || `Result ${index + 1}`)}</h4>
        <p>${escapeHtml(result.content)}</p>
        <small>
          ${escapeHtml(result.scoreLabel || "Score")}: ${escapeHtml(result.score ?? "Not available")}
          ${result.rulingDate ? ` | Date: ${escapeHtml(result.rulingDate.slice(0, 10))}` : ""}
          ${Array.isArray(result.tariffs) && result.tariffs.length > 0 ? ` | HTSUS noted: ${escapeHtml(result.tariffs.join(", "))}` : ""}
        </small>
        <small>${escapeHtml(result.scoreBasis || "")}</small>
        ${result.url ? `<a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Open CBP ruling</a>` : ""}
      </article>
    `)
    .join("");
}

function collectHsCodes(retrieval) {
  const results = Array.isArray(retrieval?.results) ? retrieval.results : [];
  const codes = new Map();

  results.forEach((result) => {
    const tariffs = Array.isArray(result.tariffs) ? result.tariffs : [];

    tariffs.forEach((code) => {
      const normalizedCode = `${code}`.trim();

      if (!normalizedCode) {
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
        url: result.url || "",
      });
    });
  });

  return Array.from(codes.values());
}

function renderHsCodes(retrieval) {
  const codes = collectHsCodes(retrieval);

  if (!retrieval?.connected) {
    hsCodeResults.textContent = "Customs ruling search is unavailable right now.";
    return;
  }

  if (codes.length === 0) {
    hsCodeResults.textContent = "No HS codes were cited in the retrieved rulings.";
    return;
  }

  hsCodeResults.innerHTML = codes
    .map((item) => `
      <article class="hs-code-card">
        <strong>${escapeHtml(item.code)}</strong>
        <span>Found in ${escapeHtml(item.sources.length)} retrieved ${item.sources.length === 1 ? "ruling" : "rulings"}</span>
        <ul>
          ${item.sources.map((source) => `
            <li>
              ${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.rulingNumber)}</a>` : escapeHtml(source.rulingNumber)}
              <small>${escapeHtml(source.title)} | Confidence: ${escapeHtml(source.score)}</small>
            </li>
          `).join("")}
        </ul>
      </article>
    `)
    .join("");
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

loadIndexStatus();
