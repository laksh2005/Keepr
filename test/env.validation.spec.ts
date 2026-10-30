import { envValidationSchema } from "../src/config/env.validation";

const base = {
  WHATSAPP_CLOUD_API_TOKEN: "t",
  WHATSAPP_PHONE_NUMBER_ID: "p",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "b",
  WHATSAPP_APP_SECRET: "a",
  WHATSAPP_GRAPH_API_VERSION: "v21.0",
  HF_TOKEN: "h",
  MONGODB_ATLAS_URI: "mongodb://localhost:27017",
  CRON_SECRET: "cron-secret-0123456789",
  ADMIN_SECRET: "admin-secret-0123456789"
};
const check = (env: Record<string, string>) => envValidationSchema.validate({ ...base, ...env });

describe("env validation", () => {
  it("accepts a complete production config and defaults the database", () => {
    const { error, value } = check({ APP_ENV: "production" });
    expect(error).toBeUndefined();
    expect(value.MONGODB_DATABASE).toBe("keepr");
  });

  it("refuses to boot staging against the production database", () => {
    expect(check({ APP_ENV: "staging", MONGODB_DATABASE: "keepr" }).error?.message).toMatch(/production database/);
  });

  it("refuses staging that doesn't name a database at all", () => {
    expect(check({ APP_ENV: "staging" }).error).toBeDefined();
  });

  it("accepts staging on its own database", () => {
    expect(check({ APP_ENV: "staging", MONGODB_DATABASE: "keepr_staging" }).error).toBeUndefined();
  });

  it("requires the webhook app secret everywhere", () => {
    expect(check({ APP_ENV: "development", WHATSAPP_APP_SECRET: undefined as never }).error).toBeDefined();
  });

  it("requires an admin secret different from the cron secret", () => {
    expect(check({ ADMIN_SECRET: undefined as never }).error).toBeDefined();
    expect(check({ ADMIN_SECRET: base.CRON_SECRET }).error).toBeDefined();
  });
});
