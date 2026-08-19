import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { MemoryService } from "../src/memory/memory.service";
import { RecallService } from "../src/recall/recall.service";

const config = { get: (_k: string, fallback: unknown) => fallback } as unknown as ConfigService;

const build = (matches: unknown[]) => {
  const huggingFace = { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]) };
  const memories = { searchForUser: jest.fn().mockResolvedValue(matches) };
  const service = new RecallService(
    huggingFace as unknown as HuggingFaceService,
    memories as unknown as MemoryService,
    config
  );
  return { service, huggingFace, memories };
};

describe("RecallService", () => {
  it("expands abbreviations in the query before embedding it", async () => {
    // Without this, "out of office" scored 0.664 against a memory saved as "ooo",
    // under the 0.7 relevance cut, and the memory was never returned.
    const { service, huggingFace } = build([]);
    await service.find("15550000001", "when am i out of office?");
    expect(huggingFace.embedQuery).toHaveBeenCalledWith(
      expect.stringContaining("out of office")
    );
  });

  it("floats dated memories to the top for a when question", async () => {
    const undated = { essence: "call the dentist", temporal_terms: [], score: 0.9 };
    const dated = { essence: "ooo on monday", temporal_terms: ["monday"], score: 0.75 };
    const { service } = build([undated, dated]);

    const results = await service.find("15550000001", "when am i out of office?");
    expect(results[0]).toBe(dated);
  });

  it("leaves ordering alone when the question is not about timing", async () => {
    const first = { essence: "call the dentist", temporal_terms: [], score: 0.9 };
    const second = { essence: "ooo on monday", temporal_terms: ["monday"], score: 0.75 };
    const { service } = build([first, second]);

    const results = await service.find("15550000001", "what did i say about the dentist");
    expect(results[0]).toBe(first);
  });

  it("keeps undated matches rather than dropping them on a when question", async () => {
    // The extractor does not recognise every phrasing, so an undated memory may still
    // be the right answer — reorder, never filter.
    const undated = { essence: "leaving after the standup", temporal_terms: [], score: 0.8 };
    const { service } = build([undated]);

    const results = await service.find("15550000001", "when do i leave?");
    expect(results).toHaveLength(1);
  });
});
