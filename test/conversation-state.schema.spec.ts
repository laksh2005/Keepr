import mongoose from "mongoose";
import { ConversationState, ConversationStateSchema } from "../src/memory/schemas/conversation-state.schema";

describe("ConversationState schema", () => {
  it("stamps each new document with its own creation time, not the boot time", async () => {
    const Model = mongoose.model(ConversationState.name + "Spec", ConversationStateSchema);
    const first = new Model({ user_id: new mongoose.Types.ObjectId(), whatsapp_number: "1" });
    await new Promise((r) => setTimeout(r, 15));
    const second = new Model({ user_id: new mongoose.Types.ObjectId(), whatsapp_number: "1" });
    expect(second.created_at.getTime()).toBeGreaterThan(first.created_at.getTime());
    expect(second.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
  });
});
