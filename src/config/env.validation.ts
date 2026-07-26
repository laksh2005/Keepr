import Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(3000),
  WHATSAPP_CLOUD_API_TOKEN: Joi.string().required(),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().required(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: Joi.string().required(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: Joi.string().required(),
  WHATSAPP_APP_SECRET: Joi.string().when("NODE_ENV", {
    is: "production",
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  WHATSAPP_GRAPH_API_VERSION: Joi.string().pattern(/^v\d+\.\d+$/).required(),
  GEMINI_API_KEY: Joi.string().required(),
  GEMINI_GENERATIVE_MODEL: Joi.string().required(),
  GEMINI_EMBEDDING_MODEL: Joi.string().default("gemini-embedding-001"),
  GEMINI_EMBEDDING_DIMENSIONS: Joi.number().integer().min(128).max(3072).default(768),
  MONGODB_ATLAS_URI: Joi.string().uri().required(),
  MONGODB_DATABASE: Joi.string().default("keepr"),
  MONGODB_VECTOR_INDEX: Joi.string().default("memory_vector_index"),
  RECALL_TOP_K: Joi.number().integer().min(1).max(10).default(5)
});
