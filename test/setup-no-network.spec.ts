describe("test network guard", () => {
  it("blocks calls to Hugging Face", async () => {
    await expect(fetch("https://router.huggingface.co/hf-inference/models/x")).rejects.toThrow(/Blocked network call/);
  });

  it("blocks calls to WhatsApp", async () => {
    await expect(fetch("https://graph.facebook.com/v21.0/123/messages")).rejects.toThrow(/Blocked network call/);
  });
});
