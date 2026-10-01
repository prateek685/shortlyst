import { Injectable, Logger } from "@nestjs/common";
import { ClassificationService } from "../classification/classification.service";
import { RolesService } from "../requirements/roles.service";
import { decryptCredentials } from "./credentials-crypto";
import { extractCvText } from "./cv-text";
import { tagNotCandidate } from "./mail-settings";
import { MailStore } from "./mail.store";
import { processThread } from "./pipeline";
import { AuthExpiredError, ProviderRequestError } from "./provider";
import { getProvider } from "./providers";
import { TriageService } from "./triage.service";

// Steps 7–14 for one thread: run the pipeline (pipeline.ts) and persist what
// it decided. Transient failures are re-thrown so pg-boss retries them with
// backoff; permanent ones are recorded instead.

@Injectable()
export class MailProcessService {
  private readonly logger = new Logger(MailProcessService.name);

  constructor(
    private readonly store: MailStore,
    private readonly triage: TriageService,
    private readonly roles: RolesService,
    private readonly classification: ClassificationService,
  ) {}

  async process(connectionId: string, threadId: string, finalAttempt: boolean): Promise<void> {
    const connection = await this.store.getConnection(connectionId);
    // Disconnected: leave the messages queued; the first sync after a
    // reconnect re-enqueues them.
    if (!connection || connection.status !== "connected") return;

    await this.store.markThreadProcessing(connectionId, threadId);
    try {
      const result = await processThread(
        {
          provider: getProvider(connection.provider),
          credentials: decryptCredentials(connection.credentialsEnc),
          state: connection.providerState ?? {},
          mailbox: connection.mailboxAddress,
          threadId,
          tagNotCandidate: tagNotCandidate(),
        },
        {
          listRoles: () => this.roles.listValidRoles(),
          triage: (text, roles) => this.triage.triage(text, roles),
          classify: (candidate, roleId) => this.classification.classifyForRole(candidate, roleId),
          extractCv: extractCvText,
        },
      );
      await this.store.recordThreadResult(connectionId, threadId, result);
    } catch (err) {
      await this.handleFailure(connectionId, threadId, err, finalAttempt);
    }
  }

  private async handleFailure(connectionId: string, threadId: string, err: unknown, finalAttempt: boolean): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof AuthExpiredError) {
      await this.store.markDisconnected(connectionId, message);
      await this.store.markThreadWaiting(connectionId, threadId, message);
      return;
    }
    if (err instanceof ProviderRequestError && err.status === 404) {
      await this.store.markThreadGone(connectionId, threadId);
      return;
    }

    const retryable = !(err instanceof ProviderRequestError) || err.retryable;
    if (retryable && !finalAttempt) {
      // Back to queued, error kept for the options page; pg-boss retries.
      await this.store.markThreadWaiting(connectionId, threadId, message);
      this.logger.warn(`thread ${threadId}: ${message} (will retry)`);
      throw err;
    }

    await this.store.markThreadFailed(connectionId, threadId, message);
    this.logger.error(`thread ${threadId} failed: ${message}`);
    if (retryable) throw err; // let pg-boss record the job as failed too
  }
}
