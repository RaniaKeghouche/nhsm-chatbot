# NHSM Helper

A chatbot for the NHSM school. Students ask questions in English, French, Arabic or Algerian Darija and get answers grounded in real school information.

**Live demo:** https://nhsm-helper.netlify.app

## How it works

Every question goes through a retrieval augmented generation (RAG) pipeline:

1. The model rewrites the query to make it easier to search.
2. A vector search compares it against embeddings of nine curated collections stored in MongoDB: FAQs, teacher profiles, specialties, study tips, wellness resources, math tips, student experiences and more.
3. The best matches are passed to Llama 3.1 through the Groq API, which writes the final answer from that context.

This keeps answers grounded in the school's actual information instead of whatever the model happens to guess.

## Stack

- **API:** Node.js, Express
- **Database:** MongoDB with Mongoose
- **LLM:** Llama 3.1 via the Groq API, with Cohere as an alternative
- **Retrieval:** vector embeddings with cosine similarity search
- **Hardening:** Helmet security headers, rate limiting, CORS rules, Winston logging

## Getting started

```sh
npm install
cp .env.example .env   # add your GROQ_API_KEY and MongoDB URI
npm run dev
```

The server starts on the port set in `.env` and exposes the chat API under `/api`.

## Evaluation

`eval-chatbot.js` and the scripts in `scripts/` measure answer quality against a test set and generate an HTML report, which helped tune the retrieval step.

## Project structure

```
src/
  app.js           Express app setup
  server.js        entry point
  config/          environment configuration
  controllers/     chat request handling
  middleware/      security and error handling
  models/          Mongoose schemas for the nine collections
  services/        RAG pipeline: rewriting, retrieval, generation
scripts/           embedding generation and evaluation tools
```
