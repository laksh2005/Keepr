# Keepr

Keepr is a multi-user WhatsApp memory service. A user sends text, links, images,
documents, videos, voice notes, or forwarded messages to one WhatsApp Business
number. Keepr stores only message metadata and user-provided context—never the
media—and later recalls a memory by replying to its original WhatsApp message.

The webhook is `GET/POST /webhook`. There are no media-download calls anywhere in
the service.

## Flow

1. Meta posts one or more inbound messages to `/webhook`.
2. The webhook signature is verified with the Meta app secret.
3. Media is always captured. Text is classified as `save` or `recall` by Gemini.
4. Save: extract caption/text/forwarding context, summarize, embed, upsert by user
   and WhatsApp message ID, and send `Saved ✓`.
5. Recall: embed the query, run Atlas Vector Search with a mandatory `user_id`
   pre-filter, then send an intro and one quoted reply per result.

Webhook retries are safe: `memories` has a unique compound index on
`{ user_id, message_id }` and writes use `$setOnInsert`.

## Prerequisites

- Node.js 20+
- A Meta developer app with WhatsApp Cloud API
- MongoDB Atlas cluster with Vector Search
- Gemini API key from Google AI Studio

## Environment

Copy `.env.example` to `.env` and fill every secret. In addition to the variables
in the original brief, the app needs these values:

- `WHATSAPP_APP_SECRET`: Meta app secret, used to validate
  `X-Hub-Signature-256`; required in production.
- `WHATSAPP_GRAPH_API_VERSION`: explicit Graph API version such as the current
  version selected for your Meta app. It is intentionally not hard-coded.
- `GEMINI_GENERATIVE_MODEL`: the Gemini model selected for classification and
  summaries. It is intentionally not hard-coded.
- `GEMINI_EMBEDDING_MODEL`: defaults to `gemini-embedding-001`.
- `GEMINI_EMBEDDING_DIMENSIONS`: defaults to `768`; it must exactly match the
  Atlas index.
- `MONGODB_DATABASE`, `MONGODB_VECTOR_INDEX`, and `RECALL_TOP_K` have safe
  defaults in `.env.example`.

`WHATSAPP_BUSINESS_ACCOUNT_ID` is retained and validated for deployment
configuration, though message send calls require the phone number ID rather than
the business account ID.

## Local development

```bash
npm install
cp .env.example .env
npm run start:dev
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

Run checks:

```bash
npm test
npm run build
```

Meta requires a public HTTPS webhook. For local testing, expose port 3000 with a
tunnel and register `https://YOUR_HOST/webhook`.

## Meta configuration

1. In Meta Developer Dashboard, create an app and add WhatsApp.
2. Put the access token, phone number ID, WABA ID, app secret, and chosen Graph API
   version in the deployment environment.
3. Under WhatsApp → Configuration, register:
   - callback URL: `https://YOUR_DEPLOYMENT/webhook`
   - verify token: the exact value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Subscribe the webhook to the `messages` field.

The verification endpoint echoes `hub.challenge` only when `hub.mode=subscribe`
and the token matches. Production POSTs require Meta's HMAC signature.

Quoted replies use the official Cloud API request shape:

```json
{
  "messaging_product": "whatsapp",
  "to": "USER_WA_ID",
  "context": { "message_id": "ORIGINAL_WAMID" },
  "type": "text",
  "text": { "body": "Saved memory essence" }
}
```

Forwarded messages are detected from `message.context.forwarded` and
`message.context.frequently_forwarded`.

## MongoDB Atlas

Create the cluster, add the application IP/network access rules and database user,
then set `MONGODB_ATLAS_URI`.

In Atlas, open the `memories` collection and create a **MongoDB Vector Search**
index named `memory_vector_index` (or the value of `MONGODB_VECTOR_INDEX`) with:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "user_id"
    }
  ]
}
```

If `GEMINI_EMBEDDING_DIMENSIONS` changes, recreate the index with the same
`numDimensions`. The `user_id` filter field is mandatory: Keepr filters inside
`$vectorSearch` and applies a second `$match` as defense in depth.

Mongoose creates the ordinary indexes during local development. In production,
create these indexes through Atlas before first traffic:

```javascript
db.users.createIndex({ whatsapp_number: 1 }, { unique: true })
db.memories.createIndex({ user_id: 1, message_id: 1 }, { unique: true })
db.memories.createIndex({ user_id: 1 })
```

## Deploy to Vercel

1. Import the repository into Vercel.
2. Set all `.env.example` variables in Project Settings → Environment Variables.
3. Deploy. `vercel.json` routes all requests to the cached Nest handler in
   `api/index.ts`.
4. Register `https://YOUR_PROJECT.vercel.app/webhook` in Meta.

The default Vercel function duration must be long enough for one Gemini summary,
one embedding, and one MongoDB write. Keep the region near the Atlas region.

## Deploy to Netlify

1. Import the repository into Netlify.
2. Set all environment variables in Site configuration.
3. Deploy using `netlify.toml`.
4. Register `https://YOUR_SITE.netlify.app/webhook` in Meta.

Netlify uses `serverless-http` to wrap the same Nest Express application.

## Privacy and operational notes

- Media IDs may appear in inbound payloads but are never persisted or fetched.
- Voice notes are not transcribed. Without user text, the saved context is the
  minimal placeholder `Voice note, no additional context given`. A separately
  sent text is captured as its own memory; users can reply directly to a voice
  note with context so WhatsApp preserves that relationship in chat.
- Every database lookup starts from the sender's WhatsApp ID. There is no
  unscoped recall method.
- Do not log webhook bodies, access tokens, captions, embeddings, or user phone
  numbers in production.
- WhatsApp delivery-status webhook events contain no `messages` array and are
  acknowledged without entering the memory flow.

## Tests

The suite covers representative intent decisions, context extraction, save
storage shape (including proof that a media ID is not saved), native quoted recall
messages, idempotent keys, and the two independent per-user constraints in the
Atlas aggregation pipeline.
