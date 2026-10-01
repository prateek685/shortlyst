import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import type { Outcome } from "../provider";

// The unit that gets classified and tagged — see the plan's "Unit of work:
// the thread". candidate/result ids are plain columns (FKs live in the
// migration) so this module doesn't pull the store's entities into its graph.
@Entity({ name: "mail_threads" })
@Unique(["connectionId", "providerThreadId"])
export class MailThreadEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "connection_id", type: "uuid" })
  connectionId!: string;

  @Column({ name: "provider_thread_id", type: "text" })
  providerThreadId!: string;

  @Column({ name: "candidate_id", type: "uuid", nullable: true })
  candidateId!: string | null;

  @Column({ name: "role_id", type: "text", nullable: true })
  roleId!: string | null;

  @Column({ name: "classification_result_id", type: "uuid", nullable: true })
  classificationResultId!: string | null;

  @Column({ type: "text", nullable: true })
  outcome!: Outcome | null;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  // Built by the provider adapter when the outcome is recorded, so readers
  // (the candidates list) don't need to know how to link into a mailbox.
  @Column({ type: "text", nullable: true })
  link!: string | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
