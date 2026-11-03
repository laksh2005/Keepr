import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../src/huggingface/huggingface.service";

const config = {
  getOrThrow: () => "hf_test_token",
  get: (_key: string, fallback: unknown) => fallback
} as unknown as ConfigService;

describe("HuggingFaceService.classifyIntent", () => {
  const buildService = () => {
    const service = new HuggingFaceService(config);
    const zeroShot = jest.fn();
    // The keyword commands must never reach the model, so a rejecting stub
    // doubles as the assertion that no inference call was made.
    (service as unknown as { client: { zeroShotClassification: jest.Mock } }).client = {
      zeroShotClassification: zeroShot
    };
    return { service, zeroShot };
  };

  it.each([
    ["list", "list"],
    ["List my memories", "list"],
    ["delete pizza", "delete"],
    ["export", "export"],
    ["next", "next"],
    ["more", "next"],
    ["show more", "next"],
    ["help", "help"],
    ["commands", "help"],
    ["what can you do", "help"],
    ["undo", "undo"],
    ["Undo!", "undo"],
    ["restore", "undo"],
    ["recap", "recapDay"],
    ["today", "recapDay"],
    ["day recap", "recapDay"],
    ["past day", "recapDay"],
    ["week recap", "recapWeek"],
    ["this week", "recapWeek"],
    ["past week", "recapWeek"]
  ])("routes %s to the %s command without an inference call", async (text, expected) => {
    const { service, zeroShot } = buildService();
    await expect(service.classifyIntent(text)).resolves.toBe(expected);
    expect(zeroShot).not.toHaveBeenCalled();
  });

  it.each([
    "listening to a podcast about rust",
    "deleted my old laptop yesterday",
    "exported the report to the shared drive",
    "next week I fly to Berlin",
    "list of groceries: milk, eggs, bread",
    "more coffee beans from the roastery on 5th",
    "today I went for a run",
    "this week has been rough"
  ])("does not mistake %s for a command", async (text) => {
    const { service, zeroShot } = buildService();
    await expect(service.classifyIntent(text)).resolves.toBe("save");
    expect(zeroShot).not.toHaveBeenCalled();
  });

  it("routes questions to recall with no inference call", async () => {
    const { service, zeroShot } = buildService();
    await expect(service.classifyIntent("where did I put the Paris photos")).resolves.toBe("recall");
    await expect(service.classifyIntent("Paris photos")).resolves.toBe("save");
    expect(zeroShot).not.toHaveBeenCalled();
  });
});
