import { Langfuse } from "langfuse";

// Lazily constructed, same reasoning as jev/client.ts's getClient(): importing
// this module (e.g. transitively through classifyCandidate.ts in a unit test)
// must never require LANGFUSE_* env vars to be set.
let client: Langfuse | undefined;

export function getLangfuse(): Langfuse {
  if (!client) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_HOST,
      // Langfuse is optional: without keys, traces become no-ops instead of
      // failed uploads.
      enabled: Boolean(publicKey && secretKey),
    });
  }
  return client;
}

/** Flushes queued events. Call before process exit — an uninstrumented exit
 * silently drops whatever hasn't been sent yet. */
export async function flush(): Promise<void> {
  if (client) {
    await client.flushAsync();
  }
}
