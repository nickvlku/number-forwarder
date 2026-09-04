import { defineConfig } from "@playwright/test";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:55432/number_forwarder_e2e";
const env = {
  DATABASE_URL,
  TWILIO_ACCOUNT_SID: "ACe2e",
  TWILIO_AUTH_TOKEN: "e2e-token",
  TWILIO_NUMBER: "+14158438558",
  CELL_NUMBER: "+14155550100",
  PUBLIC_BASE_URL: "http://localhost:3100",
  OPENAI_API_KEY: "sk-e2e",
  DASHBOARD_PASSWORD: "e2e-password",
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-32",
  PORT: "3100",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run db:migrate && npm run db:seed && npx next dev -p 3100",
    url: "http://localhost:3100/login",
    env,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
