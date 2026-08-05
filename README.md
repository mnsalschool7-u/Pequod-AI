# Pequod AI

Pequod AI is an AI-powered trade operations landing site with a live LlamaParse document-ingestion demo.

## Required dependencies

- Node.js 20 or newer
- npm
- `@llamaindex/llama-cloud` for the live LlamaParse API call
- Express and Multer for the server-side upload endpoint

Install dependencies:

```bash
npm install
```

## Environment variables

Create a local `.env` file. Do not commit it.

```bash
LLAMA_CLOUD_API_KEY=llx-your_llamacloud_api_key
PORT=3000
```

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

It supports Phase 1 of the Pequod document workflow:

1. Select or drag and drop a PDF.
2. Upload the PDF to the Pequod Express server.
3. Send the document to the real LlamaParse service using `LLAMA_CLOUD_API_KEY`.
4. Wait for the parsing job to complete.
5. Return and display markdown from LlamaParse.

The live LlamaParse call occurs in `server.js` inside `parsePdfWithLlamaParse()`.

## Test with a PDF

Use a product-information PDF that includes details such as product name, photo, materials, components, electrical specifications, intended use, country of origin, voltage, or wattage if stated.

Confirm:

- The server has `LLAMA_CLOUD_API_KEY` set.
- The uploaded file is a PDF.
- The developer verification panel shows a real parse job ID.
- The markdown output changes based on the uploaded document.
- Missing API keys, invalid files, failed jobs, and timeouts show user-facing errors.
- Browser console and server logs do not expose the API key or full document contents.

## Known limitations

- Phase 1 only is implemented.
- The demo displays raw LlamaParse markdown, but does not yet extract the structured product record.
- The customs-precedent retrieval interface is not connected yet.
- Uploads are limited to PDFs up to 15 MB.
- Temporary uploads are deleted after parsing completes or fails.

## Later customs-ruling retrieval layer

For the next phase, connect a trusted customs-ruling corpus or approved CBP ruling source. The retrieval layer should use only the structured product record derived from the uploaded document, then display query concepts transparently. It should not invent rulings, HS codes, similarity scores, or classification conclusions.
