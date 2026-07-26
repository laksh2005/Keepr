import { IntentService } from "../src/intent/intent.service";
import { GeminiService, Intent } from "../src/gemini/gemini.service";
import { InboundMessage } from "../src/whatsapp/whatsapp.types";

const textMessage = (body: string): InboundMessage => ({
  id: "wamid.1",
  from: "15550000001",
  timestamp: "1700000000",
  type: "text",
  text: { body }
});

describe("IntentService", () => {
  it.each([
    ["find those design images from last Monday", "recall"],
    ["show me the recipe I saved", "recall"],
    ["Interesting article https://example.com", "save"],
    ["Meeting notes: launch on Friday", "save"]
  ])("classifies %s as %s", async (text, expected) => {
    const gemini = {
      classifyIntent: jest.fn().mockResolvedValue(expected as Intent)
    } as unknown as GeminiService;
    const service = new IntentService(gemini);

    await expect(service.classify(textMessage(text))).resolves.toBe(expected);
    expect(gemini.classifyIntent).toHaveBeenCalledWith(text);
  });

  it("always captures media without spending an intent call", async () => {
    const gemini = { classifyIntent: jest.fn() } as unknown as GeminiService;
    const service = new IntentService(gemini);
    const image: InboundMessage = { ...textMessage(""), type: "image", image: { caption: "moodboard" } };

    await expect(service.classify(image)).resolves.toBe("save");
    expect(gemini.classifyIntent).not.toHaveBeenCalled();
  });
});
