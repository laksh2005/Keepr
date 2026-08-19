# Keepr

Keepr is a multi-user WhatsApp memory service. You send text, links, images,
documents, videos, voice notes, or forwarded messages to one WhatsApp Business
number. Keepr stores only message metadata and your own text — never the media —
and later finds a memory by replying to its original WhatsApp message.

Live at [keepr.website](https://keepr.website). The webhook is `GET/POST /webhook`;
`GET /health` reports service and database status. There are no media-download calls
anywhere in the service.

## Commands

Anything that is not one of these is either saved or treated as a question, so the
bot works without learning any syntax.

| Message | What happens |
| --- | --- |
| *anything else* | Saved as a memory |
| *a question* | Searches your memories and quotes the original message |
| `list` | Your saved memories, first 10 |
| `export` | Everything, with dates, split across messages |
| `next` | The next match after a search |
| `delete <word>` | Removes memories matching that word |
| `help` | The command list |

`list`, `export`, `next` and `help` are matched against the **whole** message, so
"list of groceries: milk, eggs" is saved as a memory rather than read as a command.
`delete` is the exception, since it always carries a search term.

## Flow

1. Meta posts one or more inbound messages to `/webhook`. Each is processed
   independently, so one failure cannot drop the rest of the batch.
2. The webhook signature is verified with the Meta app secret.
3. Media is always captured. Text is routed by exact-match commands first, then by a
   Hugging Face zero-shot classifier for save vs recall.
4. **Save**: extract caption/text/forwarding context, summarize, embed, extract any
   time references, upsert by user and WhatsApp message ID, and confirm.
5. **Recall**: embed the query, run Atlas Vector Search with a mandatory `user_id`
   pre-filter, drop matches below the relevance threshold, and quote the top result.

Webhook retries are safe: `memories` has a unique compound index on
`{ user_id, message_id }` and writes use `$setOnInsert`.

## Recall quality

Three things sit between a saved message and finding it again.

**Intent.** `bart-large-mnli` scores a label by testing the sentence "This message is
{label}." Bare "save" and "recall" make that hypothesis meaningless — 5/12 on a
hand-labelled set, worse than chance, and confidently backwards on "remember this: ..."
and "find my ...". Framing the choice as *a statement* vs *a question* is a
distinction the model actually holds, and scores 12/12 on the same set.

**Shorthand.** Chat abbreviations are invisible to `all-MiniLM-L6-v2`: "i am ooo on
monday" against "when am i out of office?" scored 0.664 on Atlas's scale, under the
0.7 relevance cut, so a genuinely relevant memory was dropped. Known abbreviations are
expanded into the embedded text — appended rather than substituted, so the shorthand
still matches itself, and applied to both the stored message and the query. That pair
now scores 0.831.

**Relevance.** Vector search always returns its top *k*, however unrelated they are, so
a small collection answered every question with its least-unrelated memory. Matches
below `RECALL_MIN_SCORE` are dropped, and the reply says nothing was found instead of
guessing.

Time references ("monday", "5pm", "27 may") are extracted at save time, so a "when is
X" question prefers memories that can actually answer it. That reorders and never
filters — the extractor does not recognise every phrasing, and an unrecognised memory
may still be the right answer.

## Stack

- **NestJS** (TypeScript) on Express, with Joi env validation
- **MongoDB Atlas** + Mongoose, using Atlas Vector Search for recall
- **Hugging Face Inference API**: zero-shot intent classification (`bart-large-mnli`),
  summarization (`distilbart-cnn-6-6`), embeddings (`all-MiniLM-L6-v2`)
- **WhatsApp Cloud API** for the webhook and messaging
- **Jest** for tests
- Deployed on **Vercel**; the marketing site lives in `website/`

## Privacy and operational notes

- Media IDs may appear in inbound payloads but are never persisted or fetched.
- Voice notes are not transcribed. Without your own text, the saved context is the
  placeholder `Voice note, no additional context given`.
- Every database lookup starts from the sender's WhatsApp ID. There is no unscoped
  recall method.
- `delete` matches its term literally. An unescaped term used to let `delete .` match
  every memory containing any character, and `delete (a+)+$` hang the function; a
  delete affecting more than one memory now previews the matches and waits for a yes.
- Replies are chunked below WhatsApp's 4096-character limit, which a long `export`
  used to exceed and fail silently.
- A bare "remember this" is held for three minutes and folded into the message that
  follows, so a caption sent ahead of a photo becomes one memory rather than two.
- Do not log webhook bodies, access tokens, captions, embeddings, or phone numbers in
  production.
- Delivery-status webhook events carry no `messages` array and are acknowledged
  without entering the memory flow.

## Tests

`npm test` — 100+ specs covering intent routing and its known false positives,
context extraction, save shape (including proof a media ID is never stored), quoted
recall and pagination, relevance filtering, per-user isolation in the Atlas pipeline,
abbreviation expansion, temporal extraction, delete escaping and confirmation, export
chunking, and per-message batch isolation.
