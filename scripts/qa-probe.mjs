// Probes Hugging Face extractive QA models against Keepr-style memories.
// Takes the token only from the HF_TOKEN environment variable you set in your own
// terminal, and prints only answers, scores and timings, never the token.
// Run from the repo root: node scripts/qa-probe.mjs
import { InferenceClient } from "@huggingface/inference";

if (!process.env.HF_TOKEN) {
  console.error("Set HF_TOKEN in this terminal first.");
  process.exit(1);
}
const client = new InferenceClient(process.env.HF_TOKEN);

const MODELS = [
  "timpal0l/mdeberta-v3-base-squad2",
  "deepset/roberta-base-squad2",
  "deepset/deberta-v3-base-squad2"
];

// [question, memory, expected answer or null when the memory doesn't answer it]
const CASES = [
  ["when is my flight to Berlin", "flight to Berlin is on the 14th, 9am departure", "the 14th, 9am"],
  ["what's my locker code", "locker code is 7734", "7734"],
  ["where did I park", "parked on level 3, spot 42", "level 3, spot 42"],
  ["how much is the rent", "rent is 42000 a month, due on the 5th", "42000"],
  ["what is the airbnb address", "airbnb address: 12 Rue de Rivoli", "12 Rue de Rivoli"],
  ["what time does the pharmacy close", "pharmacy closes at 9pm on weekdays", "9pm"],
  ["who am I meeting tomorrow", "meeting Sarah tomorrow at the cafe", "Sarah"],
  ["wifi password kya hai", "ghar ka wifi password sunflower22 hai", "sunflower22"],
  ["dentist kab hai", "dentist appointment moved to 4pm Thursday", "4pm Thursday"],
  ["when is my flight to Berlin", "banana bread recipe: 2 bananas, 1 cup flour, 1 egg", null],
  ["what's my locker code", "spare key is under the mat", null]
];

for (const model of MODELS) {
  console.log(`\n=== ${model}`);
  for (const [question, context, expected] of CASES) {
    const started = Date.now();
    try {
      const out = await client.questionAnswering({ model, inputs: { question, context }, provider: "hf-inference" });
      const r = Array.isArray(out) ? out[0] : out;
      const ms = Date.now() - started;
      console.log(
        `${r.score.toFixed(3).padStart(6)}  ${String(ms).padStart(5)}ms  Q: ${question}  ->  "${r.answer}"  (expected: ${expected ?? "NO ANSWER"})`
      );
    } catch (error) {
      console.log(`ERROR  Q: ${question}  ->  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
