import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { join } from "node:path";

// The same sentence-transformers model the Hugging Face API served, so vectors already
// stored in Atlas stay comparable. Files live in ./models (see scripts/fetch-model.mjs).
export const LOCAL_MODEL_NAME = "all-MiniLM-L6-v2";
export const LOCAL_MODEL_DIMENSIONS = 384;

type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

/**
 * Embeds text inside the app, with no network call and no credits. The model is loaded
 * on first use and kept for the life of the serverless instance, so only a cold start
 * pays for it.
 */
@Injectable()
export class LocalEmbeddingService {
  private extractor?: Promise<Extractor>;

  async embed(text: string): Promise<number[]> {
    let output: { data: ArrayLike<number> };
    try {
      this.extractor ??= this.loadExtractor().catch((error: unknown) => {
        // Forget a failed load so the next message tries again.
        this.extractor = undefined;
        throw error;
      });
      output = await (await this.extractor)(text, { pooling: "mean", normalize: true });
    } catch (error: unknown) {
      throw new ServiceUnavailableException(
        `Local embedding failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const vector = Array.from(output.data);
    if (vector.length !== LOCAL_MODEL_DIMENSIONS || typeof vector[0] !== "number") {
      throw new ServiceUnavailableException("Local embedding returned an unexpected shape");
    }
    return vector;
  }

  /** Overridden in tests; the real package is only ever loaded here. */
  protected async loadExtractor(): Promise<Extractor> {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Disk only: a missing model should fail loudly, never fetch from the network.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = process.env.LOCAL_MODEL_DIR ?? join(process.cwd(), "models");
    return (await pipeline("feature-extraction", LOCAL_MODEL_NAME, { dtype: "q8" })) as unknown as Extractor;
  }
}
