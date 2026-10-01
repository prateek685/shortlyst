import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

// Cache for the triage Jev call, keyed like classification's input_hash
// (model + text + questions) — re-reading an unchanged thread or retrying a
// job never pays for triage twice.
@Entity({ name: "mail_triage_results" })
export class MailTriageResultEntity {
  @PrimaryColumn({ name: "input_hash", type: "text" })
  inputHash!: string;

  @Column({ name: "is_application", type: "numeric" })
  isApplication!: number;

  @Column({ name: "role_id", type: "text", nullable: true })
  roleId!: string | null;

  @Column({ name: "role_confidence", type: "numeric", nullable: true })
  roleConfidence!: number | null;

  @Column({ name: "injection_risk", type: "numeric" })
  injectionRisk!: number;

  @Column({ name: "raw_answers", type: "jsonb" })
  rawAnswers!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
