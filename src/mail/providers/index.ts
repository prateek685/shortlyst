import type { MailProvider, ProviderType } from "../provider";
import { GmailProvider } from "./gmail/gmail.provider";

// The one place that knows which providers exist. Adding Outlook/IMAP later
// = a new adapter folder + one line here.
const providers: Record<ProviderType, MailProvider> = {
  gmail: new GmailProvider(),
};

export function getProvider(type: string): MailProvider {
  const provider = providers[type as ProviderType];
  if (!provider) throw new Error(`Unknown mail provider "${type}"`);
  return provider;
}

export function listProviders(): MailProvider[] {
  return Object.values(providers);
}
