import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import PgBoss from "pg-boss";

// The only file that knows about pg-boss (swap for BullMQ here if ever
// needed). pg-boss keeps its jobs in its own `pgboss` schema in our Postgres.
//
// Queues use the "stately" policy with a singleton key: per key (a mailbox
// for syncs, a thread for processing) at most one job waits and one runs.
// A new email arriving in a thread that's mid-processing therefore adds
// exactly one follow-up job, never a pile of duplicates.

const SYNC_TICK = "mail-sync-tick";
const SYNC = "mail-sync";
const PROCESS = "mail-process";

export interface SyncJob {
  connectionId: string;
}
export interface ProcessJob {
  connectionId: string;
  threadId: string;
}

export interface QueueHandlers {
  /** every MAIL_SYNC_CRON tick: enqueue a sync per connected mailbox */
  onTick(): Promise<void>;
  onSync(job: SyncJob): Promise<void>;
  /** `finalAttempt` = no retries left if this throws */
  onProcess(job: ProcessJob, finalAttempt: boolean): Promise<void>;
}

// ~1, 2, 4, 8, 16 min between tries — rides out a short provider/Jev outage.
const PROCESS_RETRY = { retryLimit: 5, retryDelay: 60, retryBackoff: true };
const SYNC_RETRY = { retryLimit: 2, retryDelay: 30, retryBackoff: true };

@Injectable()
export class MailQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueueService.name);
  private boss?: PgBoss;

  async start(handlers: QueueHandlers): Promise<void> {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (err) => this.logger.error(`pg-boss: ${err.message}`));
    await boss.start();

    await this.ensureQueue(boss, SYNC_TICK, { policy: "short" });
    await this.ensureQueue(boss, SYNC, { policy: "stately", ...SYNC_RETRY, expireInSeconds: 10 * 60 });
    await this.ensureQueue(boss, PROCESS, { policy: "stately", ...PROCESS_RETRY, expireInSeconds: 15 * 60 });

    await boss.schedule(SYNC_TICK, process.env.MAIL_SYNC_CRON ?? "*/5 * * * *");

    await boss.work(SYNC_TICK, async () => handlers.onTick());
    await boss.work<SyncJob>(SYNC, { batchSize: 1 }, async ([job]) => handlers.onSync(job!.data));

    // One polling worker per concurrency slot, each taking one thread at a
    // time — MAIL_CONCURRENCY threads in progress at once.
    const concurrency = Math.max(1, Number(process.env.MAIL_CONCURRENCY ?? 3));
    for (let i = 0; i < concurrency; i++) {
      await boss.work<ProcessJob>(PROCESS, { batchSize: 1, includeMetadata: true }, async ([job]) =>
        handlers.onProcess(job!.data, job!.retryCount >= job!.retryLimit),
      );
    }

    this.boss = boss;
    this.logger.log(`mail queue started (concurrency ${concurrency})`);
  }

  async enqueueSync(connectionId: string): Promise<void> {
    await this.requireBoss().send(SYNC, { connectionId } satisfies SyncJob, { singletonKey: connectionId });
  }

  /** Returns false when a job for this thread is already waiting. */
  async enqueueThread(connectionId: string, threadId: string): Promise<boolean> {
    const id = await this.requireBoss().send(PROCESS, { connectionId, threadId } satisfies ProcessJob, {
      singletonKey: `${connectionId}:${threadId}`,
    });
    return id !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, wait: true, timeout: 20_000 });
  }

  private requireBoss(): PgBoss {
    if (!this.boss) throw new Error("mail queue is not started");
    return this.boss;
  }

  private async ensureQueue(boss: PgBoss, name: string, options: Omit<PgBoss.Queue, "name">): Promise<void> {
    if (await boss.getQueue(name)) {
      await boss.updateQueue(name, { name, ...options });
    } else {
      await boss.createQueue(name, { name, ...options });
    }
  }
}
