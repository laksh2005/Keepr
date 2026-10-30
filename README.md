# Keepr

Keepr is a multi-user WhatsApp memory service. You send text, links, images,
documents, videos, voice notes, or forwarded messages to one WhatsApp Business
number. Keepr stores only message metadata and your own text — never the media —
and later finds a memory by replying to its original WhatsApp message.

Live at [keepr.website](https://keepr.website). The webhook is `GET/POST /webhook`;
`GET /health` reports only whether the service and database are up. There are no
media-download calls anywhere in the service.

## Commands

Anything that is not one of these is either saved or treated as a question, so the
bot works without learning any syntax.

| Message | What happens |
| --- | --- |
| *anything else* | Saved as a memory (and, if it names a future day, offers a reminder) |
| *a question* | Searches your memories and quotes the original message |
| `list` / `list 2` | Your saved memories, 10 per page |
| `export` / `export 2` | Everything, with dates, 50 per page, split across messages |
| `next` | The next match after a search |
| `recap` / `today` | What you saved in the past day |
| `week recap` / `this week` | What you saved in the past week |
| `remind me ... at/on ...` | A reminder, sent when it's due |
| `delete <word>` | Hides memories matching that word (asks first if more than one) |
| `undo` | Brings back the last delete, within 10 minutes |
| `yes` / `no` | Answers a pending delete or reminder offer; otherwise saved normally |
| `help` | The command list |

Commands are matched against the **whole** message, so "list of groceries: milk, eggs"
is saved as a memory rather than read as a command. `delete` and `remind me` are the
exceptions, since they always carry more text.

## Flow

1. Meta posts one or more inbound messages to `/webhook`. The signature is verified
   with the Meta app secret, always, in every environment.
2. Each message ID is claimed in `processed_messages` before handling, so a Meta retry
   of a message already handled is dropped before it costs inference or a second
   reply. A failed message stays claimable, so the retry still gets another go. Each
   message is processed independently, so one failure cannot drop the rest of the
   batch.
3. Media is always saved without classification. Text is routed by exact-match
   commands first, then by a Hugging Face zero-shot classifier for save vs recall.
4. **Save**: extract caption/text/forwarding context (capped at 4000 characters),
   summarize, embed, extract any time references, upsert by user and WhatsApp
   message ID, and confirm. If the text names a future day, the confirmation offers a
   reminder.
5. **Recall**: embed the query, run Atlas Vector Search with a mandatory `user_id`
   pre-filter, drop deleted and below-threshold matches, and quote the top result.

Saves are idempotent too: `memories` has a unique compound index on
`{ user_id, message_id }` and writes use `$setOnInsert`.

## Reminders and digests

- `remind me to call mom at 5pm` is parsed with chrono-node in IST and stored in
  `reminders`.
- Saving a message that names an actual future day ("dentist moved to 4pm thursday",
  "rent due on the 5th") replies "Saved ✅ Want a reminder ...? Reply *yes*". A yes
  within 10 minutes creates it; no dismisses it. A bare time ("closes at 9pm") or a
  rate ("42000 a month") is not an offer, and a day with no time defaults to 9am IST.
- `GET /cron/reminders` sends everything due. A reminder whose send fails 5 times is
  marked failed and kept, rather than retried forever.
- `GET /cron/digest` sends each user a summary of their week, once, in the Sunday
  5pm IST window. `?force=true&number=<digits>` sends one on demand to a single
  number without marking it sent.
- Both cron endpoints need the `x-cron-secret` header and are polled by
  `.github/workflows/reminder-cron.yml`.
- `POST /admin/send` (`{ to, message }`) sends one-off text. It needs `x-admin-secret`,
  which must differ from the cron secret, and is checked before the body is.

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

## Configuration

Required environment variables are validated at boot (`src/config/env.validation.ts`);
the app refuses to start without them. Beyond the WhatsApp, Hugging Face and MongoDB
credentials:

- `WHATSAPP_APP_SECRET`: required everywhere, since webhook signatures are always checked
- `CRON_SECRET`: 16+ characters, for the cron endpoints
- `ADMIN_SECRET`: 16+ characters, different from `CRON_SECRET`, for `/admin/send`
- `APP_ENV`: `production`, `staging`, `development` or `test`. With `staging`,
  `MONGODB_DATABASE` must be set and must not be the production database (`keepr`),
  so staging can never touch real users' data. Staging uses `keepr_staging`, which
  needs its own `memory_vector_index`.

## Privacy and operational notes

- Media IDs may appear in inbound payloads but are never persisted or fetched.
- Voice notes are not transcribed. Without your own text, the saved context is the
  placeholder `Voice note, no additional context given`.
- Every database lookup starts from the sender's WhatsApp ID. There is no unscoped
  recall method.
- `delete` matches its term literally. An unescaped term used to let `delete .` match
  every memory containing any character, and `delete (a+)+$` hang the function; a
  delete affecting more than one memory now previews the matches and waits for a yes.
- `delete` is a soft delete: it sets `deleted_at` and every read filters those out, so
  `undo` can restore the last batch. The app never removes rows from the database.
- Replies are chunked below WhatsApp's 4096-character limit, which a long `export`
  used to exceed and fail silently.
- A bare "remember this" is held for three minutes and folded into the message that
  follows, so a caption sent ahead of a photo becomes one memory rather than two.
- Do not log webhook bodies, access tokens, captions, embeddings, or phone numbers in
  production. Phone numbers that must appear in a log line are masked (`91******6233`).
- Delivery-status webhook events carry no `messages` array and never enter the memory
  flow. Only failed deliveries are logged, with the recipient masked and Meta's error
  code.

## Tests

`npm test` — 250 specs covering intent routing and its known false positives,
context extraction, save shape (including proof a media ID is never stored), quoted
recall and pagination, relevance filtering, per-user isolation in the Atlas pipeline,
abbreviation expansion, temporal extraction, reminder parsing and offers, soft delete
and undo, webhook dedupe, endpoint auth, env validation, and real HTTP requests
against the controllers. Every test mocks the database and WhatsApp: nothing touches
real data or sends a message.

CI (`.github/workflows/ci.yml`) runs `npm audit` (high and critical, production
dependencies), the typecheck, the build and the tests on every push and pull request.
