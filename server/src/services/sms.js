/* ============================================================
   UVID — SMS provider abstraction.
   SMS_PROVIDER=console  → log the message (dev/testing).
   Wire a real gateway (Twilio / MSG91 / Gupshup) by adding a
   case below — nothing else needs to change.
   ============================================================ */
"use strict";

const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();

function sendSms(mobile, text) {
  switch (provider) {
    case "console":
      console.log(`[SMS:${mobile}] ${text}`);
      return Promise.resolve({ ok: true, provider });
    /* example for a real gateway:
    case "twilio":
      return twilioClient.messages.create({ to: "+91" + mobile, body: text });
    */
    default:
      console.warn(`[SMS] Unknown provider "${provider}" — falling back to console.`);
      console.log(`[SMS:${mobile}] ${text}`);
      return Promise.resolve({ ok: true, provider: "console" });
  }
}

module.exports = { sendSms, provider };
