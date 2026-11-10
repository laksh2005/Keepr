import { ConfigService } from "@nestjs/config";
import { inServiceWindow, PreferencesService } from "../preferences/preferences.service";
import { WhatsAppClient } from "./whatsapp.client";

export type ProactiveOutcome = "sent" | "opted-out" | "no-template";

/**
 * Sends something Keepr started (a reminder, the weekly digest) the way WhatsApp
 * allows: never to someone who said stop, as plain text only inside the 24-hour
 * window, and as an approved template outside it. With no template configured an
 * out-of-window send is skipped rather than attempted, so nothing is sent that
 * Meta's rules forbid.
 *
 * `prefs` is optional only so callers built without it keep today's behavior.
 */
export async function sendProactive(
  client: WhatsAppClient,
  prefs: PreferencesService | undefined,
  config: ConfigService,
  to: string,
  message: { text: string; templateConfigKey: string; templateParams: string[] }
): Promise<ProactiveOutcome> {
  const state = prefs ? await prefs.get(to) : { optedOut: false, lastInboundAt: new Date() };
  if (state.optedOut) return "opted-out";

  if (inServiceWindow(state.lastInboundAt)) {
    await client.sendText(to, message.text);
    return "sent";
  }

  const template = config.get<string>(message.templateConfigKey);
  if (!template) return "no-template";
  await client.sendTemplate(to, template, config.get<string>("TEMPLATE_LANGUAGE") || "en", message.templateParams);
  return "sent";
}
