import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { MailConnectionEntity } from "./entities/mail-connection.entity";
import { MailTriageResultEntity } from "./entities/mail-triage-result.entity";
import type { MessageOutcome, PipelineResult } from "./pipeline";
import type { MessageRef, ProviderState } from "./provider";
import type { TriageAnswers } from "./triage";

// All mail-intake reads/writes in one place. Upserts are single SQL
// statements (ON CONFLICT) so parallel workers can't race each other.

export interface ConnectionStatus {
  id: string;
  provider: string;
  mailbox: string;
  status: "connected" | "disconnected";
  lastError: string | null;
  lastSyncAt: string | null;
  connectedAt: string;
  counts: { queued: number; processing: number; failed: number; done: number; skipped: number };
  /** seconds the oldest still-waiting message has been waiting */
  oldestWaitingSeconds: number | null;
}

export interface RecentThread {
  threadId: string;
  connectionId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  receivedAt: string | null;
  outcome: string | null;
  roleId: string | null;
  reason: string | null;
  link: string | null;
  status: "waiting" | "processing" | "done" | "failed";
  updatedAt: string;
}

@Injectable()
export class MailStore {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(MailConnectionEntity) private readonly connections: Repository<MailConnectionEntity>,
    @InjectRepository(MailTriageResultEntity) private readonly triage: Repository<MailTriageResultEntity>,
  ) {}

  // --- connections -------------------------------------------------------------

  getConnection(id: string): Promise<MailConnectionEntity | null> {
    return this.connections.findOneBy({ id });
  }

  listConnectedIds(): Promise<{ id: string }[]> {
    return this.connections.find({ where: { status: "connected" }, select: { id: true } });
  }

  /** A reconnect of the same mailbox keeps its cursor, so syncing resumes
   * where it stopped instead of backfilling again. */
  async upsertConnection(provider: string, mailbox: string, credentialsEnc: string): Promise<string> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `insert into mail_connections (provider, mailbox_address, credentials_enc, status)
       values ($1, $2, $3, 'connected')
       on conflict (provider, mailbox_address) do update set
         credentials_enc = excluded.credentials_enc,
         status = 'connected',
         last_error = null
       returning id`,
      [provider, mailbox, credentialsEnc],
    );
    return rows[0]!.id;
  }

  async markDisconnected(id: string, error: string): Promise<void> {
    await this.connections.update({ id }, { status: "disconnected", lastError: error });
  }

  async recordSyncError(id: string, error: string): Promise<void> {
    await this.connections.update({ id }, { lastError: error, lastSyncAt: new Date() });
  }

  async saveProviderState(id: string, providerState: ProviderState): Promise<void> {
    await this.dataSource.query(`update mail_connections set provider_state = $2 where id = $1`, [id, providerState]);
  }

  async saveCursor(id: string, cursor: string, syncedAt: Date): Promise<void> {
    await this.connections.update({ id }, { cursor, lastSyncedAt: syncedAt, lastSyncAt: new Date(), lastError: null });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.connections.delete({ id });
  }

  // --- sync: record newly listed messages ---------------------------------------

  /** Inserts the threads/messages the provider listed (ignoring ones already
   * known) in one transaction. */
  async recordListedMessages(connectionId: string, refs: MessageRef[]): Promise<void> {
    if (refs.length === 0) return;
    await this.dataSource.transaction(async (manager) => {
      const threadIds = [...new Set(refs.map((r) => r.threadId))];
      await manager.query(
        `insert into mail_threads (connection_id, provider_thread_id)
         select $1, unnest($2::text[])
         on conflict (connection_id, provider_thread_id) do nothing`,
        [connectionId, threadIds],
      );
      await manager.query(
        `insert into mail_messages (connection_id, provider_message_id, thread_id)
         select $1, m.message_id, t.id
         from unnest($2::text[], $3::text[]) as m(message_id, thread_key)
         join mail_threads t on t.connection_id = $1 and t.provider_thread_id = m.thread_key
         on conflict (connection_id, provider_message_id) do nothing`,
        [connectionId, refs.map((r) => r.messageId), refs.map((r) => r.threadId)],
      );
    });
  }

  /** Threads with messages still waiting — what the sync (re)enqueues. Also
   * how work left behind by a crash, a disconnect or "Retry failed" gets
   * picked up again: nothing depends on remembering what was enqueued. */
  async threadsWithWaitingMessages(connectionId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ provider_thread_id: string }[]>(
      `select distinct t.provider_thread_id
       from mail_messages m join mail_threads t on t.id = m.thread_id
       where m.connection_id = $1 and m.status in ('queued', 'processing')`,
      [connectionId],
    );
    return rows.map((r) => r.provider_thread_id);
  }

  // --- process: record a thread's outcome ---------------------------------------

  async markThreadProcessing(connectionId: string, providerThreadId: string): Promise<void> {
    await this.dataSource.query(
      `update mail_messages m set status = 'processing', error = null
       from mail_threads t
       where t.id = m.thread_id and t.connection_id = $1 and t.provider_thread_id = $2
         and m.status in ('queued', 'failed')`,
      [connectionId, providerThreadId],
    );
  }

  async recordThreadResult(connectionId: string, providerThreadId: string, result: PipelineResult): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `insert into mail_threads (connection_id, provider_thread_id, candidate_id, role_id,
                                   classification_result_id, outcome, reason, link, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (connection_id, provider_thread_id) do update set
           candidate_id = excluded.candidate_id,
           role_id = excluded.role_id,
           classification_result_id = excluded.classification_result_id,
           outcome = excluded.outcome,
           reason = excluded.reason,
           link = excluded.link,
           updated_at = now()
         returning id`,
        [
          connectionId,
          providerThreadId,
          result.candidateId,
          result.roleId,
          result.resultId,
          result.outcome,
          result.reason,
          result.link,
        ],
      );
      const threadRowId = rows[0]!.id;
      for (const message of result.messages) {
        await this.upsertProcessedMessage(manager, connectionId, threadRowId, message);
      }
    });
  }

  private async upsertProcessedMessage(
    manager: { query: DataSource["query"] },
    connectionId: string,
    threadRowId: string,
    message: MessageOutcome,
  ): Promise<void> {
    await manager.query(
      `insert into mail_messages (connection_id, provider_message_id, thread_id, from_email, from_name,
                                  subject, received_at, status, skip_reason, error, processed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, now())
       on conflict (connection_id, provider_message_id) do update set
         thread_id = excluded.thread_id,
         from_email = excluded.from_email,
         from_name = excluded.from_name,
         subject = excluded.subject,
         received_at = excluded.received_at,
         status = excluded.status,
         skip_reason = excluded.skip_reason,
         error = null,
         processed_at = now()`,
      [
        connectionId,
        message.messageId,
        threadRowId,
        message.fromEmail,
        message.fromName,
        message.subject,
        message.receivedAt,
        message.status,
        message.skipReason,
      ],
    );
  }

  /** The thread no longer exists in the mailbox (deleted between listing and
   * processing) — nothing left to classify or tag. */
  async markThreadGone(connectionId: string, providerThreadId: string): Promise<void> {
    await this.dataSource.query(
      `update mail_messages m set status = 'skipped', skip_reason = 'no longer in the mailbox', processed_at = now()
       from mail_threads t
       where t.id = m.thread_id and t.connection_id = $1 and t.provider_thread_id = $2
         and m.status in ('queued', 'processing', 'failed')`,
      [connectionId, providerThreadId],
    );
  }

  /** Back to queued (so the next sync re-enqueues it), keeping the error. */
  async markThreadWaiting(connectionId: string, providerThreadId: string, error: string | null): Promise<void> {
    await this.dataSource.query(
      `update mail_messages m set status = 'queued', error = $3
       from mail_threads t
       where t.id = m.thread_id and t.connection_id = $1 and t.provider_thread_id = $2
         and m.status in ('queued', 'processing')`,
      [connectionId, providerThreadId, error],
    );
  }

  async markThreadFailed(connectionId: string, providerThreadId: string, error: string): Promise<void> {
    await this.dataSource.query(
      `update mail_messages m set status = 'failed', error = $3
       from mail_threads t
       where t.id = m.thread_id and t.connection_id = $1 and t.provider_thread_id = $2
         and m.status in ('queued', 'processing')`,
      [connectionId, providerThreadId, error],
    );
  }

  /** "Retry failed": failed → queued; the next sync re-enqueues them. */
  async requeueFailed(): Promise<number> {
    const rows = await this.dataSource.query<unknown[]>(
      `update mail_messages set status = 'queued' where status = 'failed' returning id`,
    );
    return Array.isArray(rows[0]) ? (rows[0] as unknown[]).length : rows.length;
  }

  // --- triage cache ---------------------------------------------------------------

  async findTriage(inputHash: string): Promise<TriageAnswers | null> {
    const row = await this.triage.findOneBy({ inputHash });
    if (!row) return null;
    // numeric columns come back from the pg driver as strings
    return {
      isApplication: Number(row.isApplication),
      roleId: row.roleId,
      roleConfidence: row.roleConfidence === null ? null : Number(row.roleConfidence),
      injectionRisk: Number(row.injectionRisk),
    };
  }

  async saveTriage(inputHash: string, answers: TriageAnswers, rawAnswers: Record<string, unknown>): Promise<void> {
    await this.dataSource.query(
      `insert into mail_triage_results (input_hash, is_application, role_id, role_confidence, injection_risk, raw_answers)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (input_hash) do nothing`,
      [inputHash, answers.isApplication, answers.roleId, answers.roleConfidence, answers.injectionRisk, rawAnswers],
    );
  }

  // --- options page -----------------------------------------------------------------

  async listConnectionStatuses(): Promise<ConnectionStatus[]> {
    const rows = await this.dataSource.query<
      {
        id: string;
        provider: string;
        mailbox_address: string;
        status: "connected" | "disconnected";
        last_error: string | null;
        last_sync_at: Date | null;
        connected_at: Date;
        queued: string;
        processing: string;
        failed: string;
        done: string;
        skipped: string;
        oldest_waiting: Date | null;
      }[]
    >(`
      select c.id, c.provider, c.mailbox_address, c.status, c.last_error, c.last_sync_at, c.connected_at,
             count(m.*) filter (where m.status = 'queued') as queued,
             count(m.*) filter (where m.status = 'processing') as processing,
             count(m.*) filter (where m.status = 'failed') as failed,
             count(m.*) filter (where m.status = 'done') as done,
             count(m.*) filter (where m.status = 'skipped') as skipped,
             min(m.created_at) filter (where m.status in ('queued', 'processing')) as oldest_waiting
      from mail_connections c
      left join mail_messages m on m.connection_id = c.id
      group by c.id
      order by c.connected_at
    `);
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      mailbox: r.mailbox_address,
      status: r.status,
      lastError: r.last_error,
      lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
      connectedAt: new Date(r.connected_at).toISOString(),
      counts: {
        queued: Number(r.queued),
        processing: Number(r.processing),
        failed: Number(r.failed),
        done: Number(r.done),
        skipped: Number(r.skipped),
      },
      oldestWaitingSeconds: r.oldest_waiting
        ? Math.max(0, Math.round((Date.now() - new Date(r.oldest_waiting).getTime()) / 1000))
        : null,
    }));
  }

  async listRecentThreads(limit: number): Promise<RecentThread[]> {
    const rows = await this.dataSource.query<
      {
        provider_thread_id: string;
        connection_id: string;
        from_email: string | null;
        from_name: string | null;
        subject: string | null;
        received_at: Date | null;
        outcome: string | null;
        role_id: string | null;
        reason: string | null;
        link: string | null;
        waiting: boolean;
        processing: boolean;
        failed: boolean;
        updated_at: Date;
      }[]
    >(
      `select t.provider_thread_id, t.connection_id, t.outcome, t.role_id, t.reason, t.link, t.updated_at,
              first_msg.from_email, first_msg.from_name, first_msg.subject, last_msg.received_at,
              bool_or(m.status = 'queued') as waiting,
              bool_or(m.status = 'processing') as processing,
              bool_or(m.status = 'failed') as failed
       from mail_threads t
       join mail_messages m on m.thread_id = t.id
       left join lateral (
         select from_email, from_name, subject from mail_messages
         where thread_id = t.id and from_email is not null
         order by received_at asc nulls last limit 1
       ) first_msg on true
       left join lateral (
         select received_at from mail_messages
         where thread_id = t.id
         order by received_at desc nulls last limit 1
       ) last_msg on true
       group by t.id, first_msg.from_email, first_msg.from_name, first_msg.subject, last_msg.received_at
       order by coalesce(last_msg.received_at, t.updated_at) desc
       limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      threadId: r.provider_thread_id,
      connectionId: r.connection_id,
      fromEmail: r.from_email,
      fromName: r.from_name,
      subject: r.subject,
      receivedAt: r.received_at ? new Date(r.received_at).toISOString() : null,
      outcome: r.outcome,
      roleId: r.role_id,
      reason: r.reason,
      link: r.link,
      status: r.failed ? "failed" : r.processing ? "processing" : r.waiting ? "waiting" : "done",
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
}
