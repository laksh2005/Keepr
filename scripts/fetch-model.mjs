// Downloads the embedding model Keepr runs in LOCAL_MODELS mode into ./models.
// Plain HTTPS file downloads from huggingface.co: no token, no credits, no inference.
// Runs in Vercel's build (see vercel.json) and by hand. Files already present are kept,
// and any failure exits non-zero so a build never ships without its model.
//
//   node scripts/fetch-model.mjs              compressed model (what the app loads)
//   node scripts/fetch-model.mjs --with-fp32  also the full-precision one, for local checks only
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = "Xenova/all-MiniLM-L6-v2";
const TARGET = join(dirname(fileURLToPath(import.meta.url)), "..", "models", "all-MiniLM-L6-v2");
const MB = 1024 * 1024;

// [file, smallest plausible size]: a truncated or error-page download fails the check.
const FILES = [
  ["config.json", 200],
  ["tokenizer.json", 100 * 1024],
  ["tokenizer_config.json", 100],
  ["special_tokens_map.json", 50],
  ["onnx/model_quantized.onnx", 10 * MB]
];
if (process.argv.includes("--with-fp32")) FILES.push(["onnx/model.onnx", 60 * MB]);

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

for (const [file, minBytes] of FILES) {
  const destination = join(TARGET, file);
  if ((await sizeOf(destination)) >= minBytes) {
    console.log(`have      ${file}`);
    continue;
  }

  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(`https://huggingface.co/${REPO}/resolve/main/${file}`);
  if (!response.ok || !response.body) {
    console.error(`FAILED    ${file}: HTTP ${response.status}`);
    process.exit(1);
  }

  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const bytes = await sizeOf(partial);
  if (bytes < minBytes) {
    await rm(partial, { force: true });
    console.error(`FAILED    ${file}: got ${bytes} bytes, expected at least ${minBytes}`);
    process.exit(1);
  }
  await rename(partial, destination);
  console.log(`downloaded ${file} (${(bytes / MB).toFixed(1)} MB)`);
}
console.log("model ready");
