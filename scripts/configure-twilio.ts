import { createInterface } from "node:readline/promises";
import { loadEnv } from "../src/lib/env";
import { updateNumberWebhooks } from "../src/lib/twilio/rest";

const env = loadEnv(process.env);
const base = process.argv[2]?.replace(/\/+$/, "") || env.PUBLIC_BASE_URL;
const urls = {
  voiceUrl: `${base}/api/twilio/voice`,
  smsUrl: `${base}/api/twilio/sms`,
  statusCallback: `${base}/api/twilio/status`,
};

async function main() {
  console.log(`Number: ${env.TWILIO_NUMBER}`);
  console.log(`Voice URL:        ${urls.voiceUrl}`);
  console.log(`SMS URL:          ${urls.smsUrl}`);
  console.log(`Status callback:  ${urls.statusCallback}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Apply these to the Twilio number? [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("aborted");
    return;
  }
  await updateNumberWebhooks({ phoneNumber: env.TWILIO_NUMBER, ...urls });
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
