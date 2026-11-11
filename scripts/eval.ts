/**
 * Standalone eval — hits the real Hugging Face models via HuggingFaceService,
 * the same code path production uses. Run with: npx ts-node scripts/eval.ts
 *
 * Three things measured:
 *  1. Intent classification accuracy (statement vs question) on a hand-labeled set
 *  2. Abbreviation-expansion lift on cosine similarity (shorthand recall)
 *  3. Per-call latency for classifyIntent and embedQuery
 */
import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { expandAbbreviations } from "../src/common/text-expansion";

const config = new ConfigService({
  HF_TOKEN: process.env.HF_TOKEN,
  HF_SUMMARIZATION_MODEL: process.env.HF_SUMMARIZATION_MODEL,
  HF_EMBEDDING_MODEL: process.env.HF_EMBEDDING_MODEL,
  HF_ZERO_SHOT_MODEL: process.env.HF_ZERO_SHOT_MODEL,
  HF_RECALL_CONFIDENCE_THRESHOLD: process.env.HF_RECALL_CONFIDENCE_THRESHOLD
    ? Number(process.env.HF_RECALL_CONFIDENCE_THRESHOLD)
    : undefined
});
const hf = new HuggingFaceService(config);

// ---------- 1. Intent classification set (statement vs question) ----------
// Only messages that reach the zero-shot call — command shortcuts ("list", "help", etc.)
// are string-matched before this and are excluded, since they're not what's being measured.
const intentCases: Array<{ text: string; expected: "save" | "recall" }> = [
  { text: "find those design images from last Monday", expected: "recall" },
  { text: "show me the recipe I saved", expected: "recall" },
  { text: "Interesting article https://example.com", expected: "save" },
  { text: "Meeting notes: launch on Friday", expected: "save" },
  { text: "remember this: my wifi password is sunflower22", expected: "save" },
  { text: "find my wifi password", expected: "recall" },
  { text: "what did I say about the dentist appointment?", expected: "recall" },
  { text: "dentist appointment moved to 4pm Thursday", expected: "save" },
  { text: "do you remember where I parked the car", expected: "recall" },
  { text: "parked on level 3, spot 42", expected: "save" },
  { text: "when is my flight to Berlin", expected: "recall" },
  { text: "flight to Berlin is on the 14th, 9am departure", expected: "save" },
  { text: "what's the address for the airbnb", expected: "recall" },
  { text: "airbnb address: 12 Rue de Rivoli", expected: "save" },
  { text: "who did I say I was meeting tomorrow", expected: "recall" },
  { text: "meeting Sarah tomorrow at the cafe", expected: "save" },
  { text: "can you pull up the recipe for banana bread", expected: "recall" },
  { text: "banana bread recipe: 2 bananas, 1 cup flour, 1 egg", expected: "save" },
  { text: "remind me what my locker code is", expected: "recall" },
  { text: "locker code is 7734", expected: "save" },
  { text: "where did I put the spare key", expected: "recall" },
  { text: "spare key is under the mat", expected: "save" },
  { text: "what time does the pharmacy close", expected: "recall" },
  { text: "pharmacy closes at 9pm on weekdays", expected: "save" },
  { text: "do I have anything saved about the insurance renewal", expected: "recall" },
  { text: "insurance renewal due March 3rd", expected: "save" },
  { text: "how much did I say the rent was", expected: "recall" },
  { text: "rent is 42000 a month, due on the 5th", expected: "save" },
  { text: "did I save anything about mom's birthday", expected: "recall" },
  { text: "mom's birthday is June 12th, she wants a plant", expected: "save" },
  { text: "what was that book title I mentioned", expected: "recall" },
  { text: "book title: Project Hail Mary by Andy Weir", expected: "save" },
  { text: "find the notes from the client call", expected: "recall" },
  { text: "client call notes: they want a Q3 delivery", expected: "save" },
  { text: "what's my gym membership number", expected: "recall" },
  { text: "gym membership number is GM-88213", expected: "save" },
  { text: "is there anything saved about the passport renewal", expected: "recall" },
  { text: "passport renewal appointment is next Tuesday at 11am", expected: "save" },
  { text: "what did I note about the new hire", expected: "recall" },
  { text: "new hire starts on the 1st, needs a laptop set up", expected: "save" }
];

// ---------- 2. Abbreviation lift set (shorthand recall) ----------
const abbrevPairs: Array<{ stored: string; query: string; abbrev: string }> = [
  { stored: "i am ooo on monday", query: "when am i out of office?", abbrev: "ooo" },
  { stored: "wfh today, back in office tomorrow", query: "am i working from home", abbrev: "wfh" },
  { stored: "need this eod, no exceptions", query: "when is this due by end of day", abbrev: "eod" },
  { stored: "taking pto next friday", query: "when is my paid time off", abbrev: "pto" },
  { stored: "eta 15 minutes, traffic is bad", query: "what's my estimated time of arrival", abbrev: "eta" },
  { stored: "1:1 with manager moved to thursday", query: "when is my one on one meeting", abbrev: "1:1" },
  { stored: "send the mtg notes by cob", query: "when do I need the meeting notes by", abbrev: "mtg/cob" }
];

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log(`Running eval against live HF models (${new Date().toISOString()})\n`);

  // --- Intent accuracy + latency ---
  let correct = 0;
  const intentLatencies: number[] = [];
  const misses: string[] = [];

  for (const { text, expected } of intentCases) {
    const start = Date.now();
    const got = await hf.classifyIntent(text);
    intentLatencies.push(Date.now() - start);
    if (got === expected) correct++;
    else misses.push(`  "${text}" -> got ${got}, expected ${expected}`);
  }

  console.log("=== Intent classification (statement vs question) ===");
  console.log(`Accuracy: ${correct}/${intentCases.length} (${((correct / intentCases.length) * 100).toFixed(1)}%)`);
  if (misses.length) {
    console.log("Misses:");
    misses.forEach((m) => console.log(m));
  }
  console.log(`Latency: avg ${avg(intentLatencies).toFixed(0)}ms, p50 ${percentile(intentLatencies, 50).toFixed(0)}ms, p95 ${percentile(intentLatencies, 95).toFixed(0)}ms\n`);

  // --- Abbreviation lift ---
  console.log("=== Abbreviation expansion lift (cosine similarity) ===");
  const liftResults: number[] = [];
  for (const { stored, query, abbrev } of abbrevPairs) {
    const [rawStoredEmb, rawQueryEmb, expStoredEmb, expQueryEmb] = await Promise.all([
      hf.embedDocument(stored),
      hf.embedQuery(query),
      hf.embedDocument(expandAbbreviations(stored)),
      hf.embedQuery(expandAbbreviations(query))
    ]);
    const before = cosine(rawStoredEmb, rawQueryEmb);
    const after = cosine(expStoredEmb, expQueryEmb);
    liftResults.push(after - before);
    console.log(`  [${abbrev}] "${stored}" vs "${query}": ${before.toFixed(3)} -> ${after.toFixed(3)} (+${(after - before).toFixed(3)})`);
  }
  console.log(`Average lift: +${avg(liftResults).toFixed(3)}\n`);

  // --- Embedding latency (separate from the lift calls above, clean single-call timing) ---
  const embedLatencies: number[] = [];
  for (const { query } of abbrevPairs) {
    const start = Date.now();
    await hf.embedQuery(query);
    embedLatencies.push(Date.now() - start);
  }
  console.log("=== Embedding call latency ===");
  console.log(`avg ${avg(embedLatencies).toFixed(0)}ms, p50 ${percentile(embedLatencies, 50).toFixed(0)}ms, p95 ${percentile(embedLatencies, 95).toFixed(0)}ms\n`);

  console.log("=== Summary ===");
  console.log(`Intent accuracy: ${correct}/${intentCases.length}`);
  console.log(`Abbreviation lift: +${avg(liftResults).toFixed(3)} avg cosine similarity`);
  console.log(`Intent call latency: avg ${avg(intentLatencies).toFixed(0)}ms`);
  console.log(`Embedding call latency: avg ${avg(embedLatencies).toFixed(0)}ms`);
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function percentile(nums: number[], p: number): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
