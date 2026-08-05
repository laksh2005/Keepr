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
3. Media is always captured. Text is classified as `save` or `recall` by a Hugging Face
   zero-shot classifier.
4. Save: extract caption/text/forwarding context, summarize, embed, upsert by user
   and WhatsApp message ID, and send `Saved ✓`.
5. Recall: embed the query, run Atlas Vector Search with a mandatory `user_id`
   pre-filter, then send an intro and one quoted reply per result.

Webhook retries are safe: `memories` has a unique compound index on
`{ user_id, message_id }` and writes use `$setOnInsert`.

## Stack

- **NestJS** (TypeScript) on Express, with Joi env validation
- **MongoDB Atlas** + Mongoose, using Atlas Vector Search for recall
- **Hugging Face Inference API**: zero-shot intent classification (`bart-large-mnli`),
  summarization (`distilbart-cnn-6-6`), embeddings (`all-MiniLM-L6-v2`)
- **WhatsApp Cloud API** for the webhook and messaging
- **Jest** for tests

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
 