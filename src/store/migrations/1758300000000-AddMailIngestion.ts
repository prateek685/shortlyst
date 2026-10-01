import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMailIngestion1758300000000 implements MigrationInterface {
  name = "AddMailIngestion1758300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "candidates" add column "email" text`);
    await queryRunner.query(`alter table "roles" add column "description" text`);

    await queryRunner.query(`
      create table "mail_connections" (
        "id" uuid primary key default gen_random_uuid(),
        "provider" text not null,
        "mailbox_address" text not null,
        "credentials_enc" text not null,
        "status" text not null default 'connected',
        "last_error" text,
        "cursor" text,
        "last_synced_at" timestamptz,
        "last_sync_at" timestamptz,
        "provider_state" jsonb not null default '{}',
        "connected_at" timestamptz not null default now(),
        unique ("provider", "mailbox_address")
      )
    `);

    await queryRunner.query(`
      create table "mail_threads" (
        "id" uuid primary key default gen_random_uuid(),
        "connection_id" uuid not null references "mail_connections"("id") on delete cascade,
        "provider_thread_id" text not null,
        "candidate_id" uuid references "candidates"("id") on delete set null,
        "role_id" text,
        "classification_result_id" uuid references "classification_results"("id") on delete set null,
        "outcome" text,
        "reason" text,
        "link" text,
        "updated_at" timestamptz not null default now(),
        unique ("connection_id", "provider_thread_id")
      )
    `);
    await queryRunner.query(`create index "IDX_mail_threads_candidate_id" on "mail_threads" ("candidate_id")`);

    await queryRunner.query(`
      create table "mail_messages" (
        "id" uuid primary key default gen_random_uuid(),
        "connection_id" uuid not null references "mail_connections"("id") on delete cascade,
        "provider_message_id" text not null,
        "thread_id" uuid not null references "mail_threads"("id") on delete cascade,
        "from_email" text,
        "from_name" text,
        "subject" text,
        "received_at" timestamptz,
        "status" text not null default 'queued',
        "skip_reason" text,
        "error" text,
        "processed_at" timestamptz,
        "created_at" timestamptz not null default now(),
        unique ("connection_id", "provider_message_id")
      )
    `);
    await queryRunner.query(`create index "IDX_mail_messages_thread_id" on "mail_messages" ("thread_id")`);
    await queryRunner.query(`create index "IDX_mail_messages_status" on "mail_messages" ("connection_id", "status")`);

    await queryRunner.query(`
      create table "mail_triage_results" (
        "input_hash" text primary key,
        "is_application" numeric not null,
        "role_id" text,
        "role_confidence" numeric,
        "injection_risk" numeric not null,
        "raw_answers" jsonb not null,
        "created_at" timestamptz not null default now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "mail_triage_results"`);
    await queryRunner.query(`drop table "mail_messages"`);
    await queryRunner.query(`drop table "mail_threads"`);
    await queryRunner.query(`drop table "mail_connections"`);
    await queryRunner.query(`alter table "roles" drop column "description"`);
    await queryRunner.query(`alter table "candidates" drop column "email"`);
  }
}
