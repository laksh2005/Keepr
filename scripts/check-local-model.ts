// Manual check of the local embedding model; nothing here touches the network.
//   npx ts-node scripts/check-local-model.ts
// Needs ./models (node scripts/fetch-model.mjs --with-fp32 for the drift comparison).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LocalEmbeddingService } from "../src/huggingface/local-embedding.service";

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0); // both unit length
const norm = (a: number[]) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));

const SENTENCES = [
  "wifi password",
  "internet password",
  "banana bread recipe",
  "i am ooo on monday",
  "when am i out of office?",
  "dentist appointment on thursday at 4pm",
  "the spare key is under the blue mat"
];

async function main() {
  const local = new LocalEmbeddingService();

  let started = performance.now();
  const first = await local.embed(SENTENCES[0]);
  console.log(`cold start (model load + first embed): ${Math.round(performance.now() - started)} ms`);
  console.log(`dimensions: ${first.length}, norm: ${norm(first).toFixed(4)}`);

  started = performance.now();
  const q8 = [] as number[][];
  for (const text of SENTENCES) q8.push(await local.embed(text));
  console.log(`warm embed: ${Math.round((performance.now() - started) / SENTENCES.length)} ms each`);

  console.log("\nsimilarity (compressed model):");
  const show = (a: number, b: number) =>
    console.log(`  ${cosine(q8[a], q8[b]).toFixed(3)}  "${SENTENCES[a]}"  vs  "${SENTENCES[b]}"`);
  show(0, 1); // should be high
  show(0, 2); // should be low
  show(3, 4); // shorthand pair
  show(5, 4);

  const fp32Path = join(process.cwd(), "models", "all-MiniLM-L6-v2", "onnx", "model.onnx");
  if (!existsSync(fp32Path)) {
    console.log("\n(no full-precision file, skipping the drift comparison)");
    return;
  }
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.localModelPath = join(process.cwd(), "models");
  const full = await pipeline("feature-extraction", "all-MiniLM-L6-v2", { dtype: "fp32" });
  console.log("\ncompressed vs full precision, same text (1.000 = identical):");
  let worst = 1;
  for (let i = 0; i < SENTENCES.length; i++) {
    const reference = Array.from((await full(SENTENCES[i], { pooling: "mean", normalize: true })).data as ArrayLike<number>);
    const c = cosine(q8[i], reference);
    worst = Math.min(worst, c);
    console.log(`  ${c.toFixed(4)}  "${SENTENCES[i]}"`);
  }
  console.log(`worst: ${worst.toFixed(4)}`);
  console.log(`memory used: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
