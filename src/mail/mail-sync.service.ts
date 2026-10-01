import { Injectable, Logger } from "@nestjs/common";
import { decryptCredentials } from "./credentials-crypto";
import { MailQueueService } from "./mail-queue.service";
import { taggedOutcomes } from "./mail-settings";
import { MailStore } from "./mail.store";
import { AuthExpiredError, CursorExpiredError, type MessageRef } from "./provider";
import { getProvider } from "./providers";

// Steps 2–5 of the plan: find new mail since the stored cursor, record it,
// queue one job per thread, and only then advance the cursor. Uses only the
// MailProvider interface.

const OVERLAP_MS = 60 * 60 * 1000;

@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);

  constructor(
    private readonly store: MailStore,
    private readonly queue: MailQueueService,
  ) {}

  async enqueueAllSyncs(): Promise<void> {
    for (const { id } of await this.store.listConnectedIds()) {
      await this.queue.enqueueSync(id);
    }
  }

  async sync(connectionId: string): Promise<void> {
    const connection = await this.store.getConnection(connectionId);
    if (!connection || connection.status !== "connected") return;

    const provider = getProvider(connection.provider);
    const credentials = decryptCredentials(connection.credentialsEnc);

    try {
      // Tags are created here, once, before any thread is queued — so
      // parallel workers never race to create the same label.
      const providerState = await provider.ensureTags(credentials, connection.providerState ?? {}, taggedOutcomes());
      if (providerState !== connection.providerState) {
        await this.store.saveProviderState(connectionId, providerState);
      }

      const listingStartedAt = new Date();
      let refs: MessageRef[];
      let nextCursor: string;
      try {
        if (!connection.cursor) throw new CursorExpiredError("first sync");
        ({ messages: refs, nextCursor } = await provider.listChangedThreads(credentials, connection.cursor));
      } catch (err) {
        if (!(err instanceof CursorExpiredError)) throw err;
        // Take the new cursor *before* searching, so mail arriving during
        // the search is covered by the next run rather than missed.
        nextCursor = await provider.initialCursor(credentials);
        const since = connection.lastSyncedAt
          ? new Date(connection.lastSyncedAt.getTime() - OVERLAP_MS)
          : new Date(Date.now() - Number(process.env.MAIL_BACKFILL_DAYS ?? 7) * 24 * 60 * 60 * 1000);
        refs = await provider.listThreadsSince(credentials, since);
        this.logger.log(`[${connection.mailboxAddress}] ${err.message} → searched since ${since.toISOString()}`);
      }

      await this.store.recordListedMessages(connectionId, refs);
      for (const threadId of await this.store.threadsWithWaitingMessages(connectionId)) {
        await this.queue.enqueueThread(connectionId, threadId);
      }
      // Only after the new messages are safely recorded — a crash before
      // this line re-lists the same messages next run, which are skipped.
      await this.store.saveCursor(connectionId, nextCursor, listingStartedAt);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        await this.store.markDisconnected(connectionId, err.message);
        this.logger.warn(`[${connection.mailboxAddress}] disconnected: ${err.message}`);
        return;
      }
      await this.store.recordSyncError(connectionId, (err as Error).message);
      throw err;
    }
  }
}
