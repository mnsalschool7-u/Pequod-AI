# Pequod AI

Pequod AI is an AI powered trade operations landing site with a live LlamaParse document ingestion demo.

## Required dependencies

* Node.js 20 or newer
* npm
* LlamaCloud SDK for the live LlamaParse API call
* Express and Multer for the server side upload endpoint

Install dependencies:

```bash
npm install
```

## Environment variables

Create a local `.env` file. Do not commit it.

```bash
LLAMA_CLOUD_API_KEY=your_llamacloud_api_key
LLAMA_CLOUD_INDEX_ID=optional_customs_ruling_index_id
PORT=3000
```

`LLAMA_CLOUD_INDEX_ID` is optional. When it is not set, the demo still parses the uploaded PDF, extracts a structured product record, and generates the customs retrieval query, but it does not show ruling matches.

Optional existing variables are documented in `.env.example`.

## Run locally

```bash
npm start
```

Then open:

```text
http://localhost:3000
http://localhost:3000/demo/llamaparse
```

## LlamaParse demo

The demo route is:

```text
/demo/llamaparse
```

It supports the Pequod document workflow:

1. Select or drag and drop a PDF.
2. Upload the PDF to the Pequod Express server.
3. Send the document to the real LlamaParse service using `LLAMA_CLOUD_API_KEY`.
4. Wait for the parsing job to complete.
5. Return and display markdown from LlamaParse.
6. Extract document supported product facts into a structured record.
7. Generate a customs retrieval profile from the extracted facts.
8. Retrieve matching customs ruling documents from LlamaParse Index when `LLAMA_CLOUD_INDEX_ID` is configured.

The live LlamaParse parse call occurs in `server.js` inside `parsePdfWithLlamaParse()`. The live LlamaParse Index retrieval call occurs in `retrieveCustomsPrecedents()`.

## Test with a PDF

Use a product information PDF that includes details such as product name, photo, materials, components, electrical specifications, intended use, country of origin, voltage, or wattage if stated.

Confirm:

* The server has `LLAMA_CLOUD_API_KEY` set.
* The uploaded file is a PDF.
* The developer verification panel shows a real parse job ID.
* The markdown output changes based on the uploaded document.
* The structured product table uses only facts supported by the uploaded document.
* The customs retrieval profile changes based on the extracted product facts.
* If `LLAMA_CLOUD_INDEX_ID` is configured, retrieval returns real index results.
* If `LLAMA_CLOUD_INDEX_ID` is not configured, the page states that no customs ruling index has been connected yet.
* Missing API keys, invalid files, failed jobs, and timeouts show user facing errors.
* Browser console and server logs do not expose the API key or full document contents.

## Known limitations

* Structured extraction is conservative and rule based for this demo.
* Customs precedent retrieval requires a real LlamaParse Index containing approved customs ruling documents.
* The demo does not invent rulings, HS codes, similarity scores, or classification conclusions.
* Uploads are limited to PDFs up to 15 MB.
* Temporary uploads are deleted after parsing completes or fails.

## Customs ruling retrieval layer

Create or connect a trusted customs ruling corpus or approved CBP ruling source in LlamaParse Index, then set `LLAMA_CLOUD_INDEX_ID` on the Render backend service. The retrieval layer uses only the structured product record derived from the uploaded document, displays query concepts transparently, and returns real index results when available.
