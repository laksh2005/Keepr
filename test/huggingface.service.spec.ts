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
    ["what can you do", "help"]
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
    "more coffee beans from the roastery on 5th"
  ])("does not mistake %s for a command", async (text) => {
    const { service, zeroShot } = buildService();
    zeroShot.mockResolvedValue([{ label: "a statement", score: 0.9 }]);
    await expect(service.classifyIntent(text)).resolves.toBe("save");
    expect(zeroShot).toHaveBeenCalled();
  });

  it("falls back to the model for ordinary recall phrasing", async () => {
    const { service, zeroShot } = buildService();
    zeroShot.mockResolvedValue([
      { label: "a question", score: 0.82 },
      { label: "a statement", score: 0.18 }
    ]);
    await expect(service.classifyIntent("where did I put the Paris photos")).resolves.toBe("recall");
  });

  it("treats a low-confidence recall as a save", async () => {
    const { service, zeroShot } = buildService();
    zeroShot.mockResolvedValue([
      { label: "a question", score: 0.51 },
      { label: "a statement", score: 0.49 }
    ]);
    await expect(service.classifyIntent("Paris photos")).resolves.toBe("save");
  });

  // Bare "save"/"recall" labels scored worse than chance against bart-large-mnli
  // (see the note in huggingface.service.ts). Pin the framing so a well-meaning
  // simplification back to the literal intent names cannot land unnoticed.
  it("asks the model to judge statement vs question, not save vs recall", async () => {
    const { service, zeroShot } = buildService();
    zeroShot.mockResolvedValue([{ label: "a statement", score: 0.9 }]);
    await service.classifyIntent("the spare key is under the mat");

    const params = zeroShot.mock.calls[0][0].parameters;
    expect(params.candidate_labels).toEqual(["a statement", "a question"]);
    expect(params.hypothesis_template).toBe("This message is {}.");
  });
});
