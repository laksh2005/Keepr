// Tests must never reach Hugging Face, WhatsApp or anything else real: inference
// costs credits and a send reaches a real phone. Any fetch to a non-local host fails
// loudly instead, so a missing mock shows up as a test failure, not a real call.
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Blocked network call in tests: ${url.origin}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
