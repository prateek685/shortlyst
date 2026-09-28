import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClassificationInputHash1758200000000 implements MigrationInterface {
  name = "AddClassificationInputHash1758200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "classification_results" add column "input_hash" text`);
    await queryRunner.query(
      `create index "idx_classification_results_input_hash" on "classification_results" ("input_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop index "idx_classification_results_input_hash"`);
    await queryRunner.query(`alter table "classification_results" drop column "input_hash"`);
  }
}
