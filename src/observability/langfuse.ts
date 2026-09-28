import { Langfuse } from "langfuse";

// Lazily constructed, same reasoning as jev/client.ts's getClient(): importing
// this module (e.g. transitively through classifyCandidate.ts in a unit test)
// must never require LANGFUSE_* env vars to be set.
let client: Langfuse | undefined;

export function getLangfuse(): Langfuse {
  if (!client) {
    client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST,
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
