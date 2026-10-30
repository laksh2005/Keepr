import { InboundLogService } from "../src/whatsapp/inbound-log.service";

describe("InboundLogService", () => {
  it("claims an unseen message id", async () => {
    const updateOne = jest.fn().mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 });
    const service = new InboundLogService({ updateOne } as never);
    await expect(service.claim("wamid.a")).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("refuses an id already done or in flight", async () => {
    const updateOne = jest
      .fn()
      .mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 0 });
    const service = new InboundLogService({ updateOne } as never);
    await expect(service.claim("wamid.a")).resolves.toBe(false);
    expect(updateOne).toHaveBeenLastCalledWith(
      { message_id: "wamid.a", status: "failed" },
      { $set: { status: "processing" } }
    );
  });

  it("re-claims an id whose last attempt failed", async () => {
    const updateOne = jest
      .fn()
      .mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 1 });
    const service = new InboundLogService({ updateOne } as never);
    await expect(service.claim("wamid.a")).resolves.toBe(true);
  });

  it("never deletes anything", async () => {
    const model = { updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }), deleteOne: jest.fn(), deleteMany: jest.fn() };
    const service = new InboundLogService(model as never);
    await service.claim("wamid.a");
    await service.markDone("wamid.a");
    await service.markFailed("wamid.a");
    expect(model.deleteOne).not.toHaveBeenCalled();
    expect(model.deleteMany).not.toHaveBeenCalled();
  });
});
