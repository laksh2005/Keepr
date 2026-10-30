import Joi from "joi";

export const PRODUCTION_DATABASE = "keepr";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(3000),
  WHATSAPP_CLOUD_API_TOKEN: Joi.string().required(),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().required(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: Joi.string().required(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: Joi.string().required(),
  // Required everywhere: webhook signatures are always checked (see WhatsAppController).
  WHATSAPP_APP_SECRET: Joi.string().required(),
  WHATSAPP_GRAPH_API_VERSION: Joi.string().pattern(/^v\d+\.\d+$/).required(),
  HF_TOKEN: Joi.string().required(),
  HF_SUMMARIZATION_MODEL: Joi.string().default("sshleifer/distilbart-cnn-6-6"),
  HF_EMBEDDING_MODEL: Joi.string().default("sentence-transformers/all-MiniLM-L6-v2"),
  HF_ZERO_SHOT_MODEL: Joi.string().default("facebook/bart-large-mnli"),
  HF_RECALL_CONFIDENCE_THRESHOLD: Joi.number().min(0.5).max(0.95).default(0.6),
  MONGODB_ATLAS_URI: Joi.string().uri().required(),
  // Which deployment this is. Separate from NODE_ENV, which is "production" for any
  // built deploy, staging included.
  APP_ENV: Joi.string().valid("production", "staging", "development", "test").default("development"),
  // Staging must name its own database: sharing prod's meant staging test messages,
  // reminders and digests acted on real users' data. Refusing to boot is the point.
  MONGODB_DATABASE: Joi.string().when("APP_ENV", {
    is: "staging",
    then: Joi.required().invalid(PRODUCTION_DATABASE).messages({
      "any.invalid": `staging must not use the production database "${PRODUCTION_DATABASE}"`
    }),
    otherwise: Joi.optional().default(PRODUCTION_DATABASE)
  }),
  MONGODB_VECTOR_INDEX: Joi.string().default("memory_vector_index"),
  RECALL_TOP_K: Joi.number().integer().min(1).max(10).default(5),
  CRON_SECRET: Joi.string().min(16).required(),
  // Separate from CRON_SECRET so the scheduler's secret can't send free text.
  ADMIN_SECRET: Joi.string().min(16).invalid(Joi.ref("CRON_SECRET")).required()
});
