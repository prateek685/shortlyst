import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1758000000000 implements MigrationInterface {
  name = "Init1758000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`create extension if not exists pgcrypto`);

    await queryRunner.query(`
      create table "candidates" (
        "id" uuid primary key default gen_random_uuid(),
        "external_id" text unique,
        "source" text not null,
        "profile_text" text not null,
        "structured_profile" jsonb,
        "created_at" timestamptz not null default now()
      )
    `);

    await queryRunner.query(`
      create table "classification_results" (
        "id" uuid primary key default gen_random_uuid(),
        "candidate_id" uuid not null references "candidates"("id") on delete cascade,
        "role_id" text not null,
        "dimension_scores" jsonb not null,
        "composite_score" numeric not null,
        "composite_confidence" numeric,
        "recommendation" text not null,
        "needs_review" boolean not null default false,
        "review_reason" text,
        "raw_answers" jsonb not null,
        "created_at" timestamptz not null default now()
      )
    `);

    await queryRunner.query(`
      create index "IDX_classification_results_candidate_id"
      on "classification_results" ("candidate_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "classification_results"`);
    await queryRunner.query(`drop table "candidates"`);
  }
}
