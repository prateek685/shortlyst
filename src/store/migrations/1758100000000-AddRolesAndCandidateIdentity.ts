import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRolesAndCandidateIdentity1758100000000 implements MigrationInterface {
  name = "AddRolesAndCandidateIdentity1758100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table "candidates"
        add column "name" text,
        add column "headline" text,
        add column "location" text,
        add column "photo_url" text
    `);

    await queryRunner.query(`
      create table "roles" (
        "id" uuid primary key default gen_random_uuid(),
        "role_id" text unique not null,
        "contact_threshold" numeric not null,
        "reject_threshold" numeric not null,
        "confidence_floor" numeric not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now()
      )
    `);

    await queryRunner.query(`
      create table "role_dimensions" (
        "id" uuid primary key default gen_random_uuid(),
        "role_id" uuid not null references "roles"("id") on delete cascade,
        "dimension_id" text not null,
        "instructions" text not null,
        "weight" numeric not null,
        "levels" jsonb not null,
        unique ("role_id", "dimension_id")
      )
    `);
    await queryRunner.query(`
      create index "IDX_role_dimensions_role_id" on "role_dimensions" ("role_id")
    `);

    await queryRunner.query(`
      create table "role_must_haves" (
        "id" uuid primary key default gen_random_uuid(),
        "role_id" uuid not null references "roles"("id") on delete cascade,
        "must_have_id" text not null,
        "instructions" text not null,
        unique ("role_id", "must_have_id")
      )
    `);
    await queryRunner.query(`
      create index "IDX_role_must_haves_role_id" on "role_must_haves" ("role_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "role_must_haves"`);
    await queryRunner.query(`drop table "role_dimensions"`);
    await queryRunner.query(`drop table "roles"`);
    await queryRunner.query(`
      alter table "candidates"
        drop column "name",
        drop column "headline",
        drop column "location",
        drop column "photo_url"
    `);
  }
}
