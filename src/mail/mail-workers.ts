import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { MailProcessService } from "./mail-process.service";
import { MailQueueService } from "./mail-queue.service";
import { MailSyncService } from "./mail-sync.service";

// Wires the queue's jobs to the sync and process services once the app has
// booted (kept separate so the queue, sync and process services don't
// depend on each other in a loop).
@Injectable()
export class MailWorkers implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailWorkers.name);

  constructor(
    private readonly queue: MailQueueService,
    private readonly sync: MailSyncService,
    private readonly processor: MailProcessService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.start({
        onTick: () => this.sync.enqueueAllSyncs(),
        onSync: ({ connectionId }) => this.sync.sync(connectionId),
        onProcess: ({ connectionId, threadId }, finalAttempt) =>
          this.processor.process(connectionId, threadId, finalAttempt),
      });
    } catch (err) {
      // The rest of the API (LinkedIn classification, roles, candidates)
      // keeps working if the mail queue can't start.
      this.logger.error(`mail queue failed to start: ${(err as Error).message}`);
    }
  }
}
