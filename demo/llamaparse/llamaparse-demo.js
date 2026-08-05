const form = document.querySelector("#parse-form");
const fileInput = document.querySelector("#document-file");
const dropZone = document.querySelector("#drop-zone");
const formError = document.querySelector("#form-error");
const fileStatus = document.querySelector("#file-status");
const parseStatus = document.querySelector("#parse-status");
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
const steps = Array.from(document.querySelectorAll("#processing-steps li"));
const demoApiBaseUrl =
  window.location.hostname === "pequodai.app" ? "https://pequod-ai-parser-api.onrender.com" : "";

let previewUrl = "";

const legacyParserHash = ["#parser", "output"].join(String.fromCharCode(45));

if (window.location.hash === legacyParserHash) {
  history.replaceState(null, "", "#parseroutput");
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
