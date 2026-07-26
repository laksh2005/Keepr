import { ContextExtractorService } from "../src/whatsapp/context-extractor.service";
import { InboundMessage } from "../src/whatsapp/whatsapp.types";

describe("ContextExtractorService", () => {
  const service = new ContextExtractorService();
  const base: InboundMessage = {
    id: "wamid.1",
    from: "15550000001",
    timestamp: "1700000000",
    type: "text"
  };

  it("extracts captions without touching media IDs", () => {
    expect(
      service.extract({ ...base, type: "image", image: { id: "media-secret", caption: "blue logo idea" } })
    ).toEqual({ type: "image", context: "blue logo idea" });
  });

  it("marks forwarded payloads from the documented context flags", () => {
    expect(
      service.extract({ ...base, context: { forwarded: true }, text: { body: "Useful checklist" } })
    ).toEqual({ type: "forwarded", context: "Forwarded message. Useful checklist" });
  });

  it("uses a minimal voice placeholder and never transcribes", () => {
    expect(service.extract({ ...base, type: "audio", audio: { voice: true, id: "media-id" } })).toEqual({
      type: "voice",
      context: "Voice note, no additional context given"
    });
  });
});
