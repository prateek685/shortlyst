import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Candidate } from "./candidate.entity";

@Entity({ name: "classification_results" })
export class ClassificationResultEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @ManyToOne(() => Candidate, { onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_id" })
  candidate!: Candidate;

  @Column({ name: "role_id", type: "text" })
  roleId!: string;

  // per-dimension { score, confidence, probabilities }
  @Column({ name: "dimension_scores", type: "jsonb" })
  dimensionScores!: Record<string, unknown>;

  @Column({ name: "composite_score", type: "numeric" })
  compositeScore!: number;

  @Column({ name: "composite_confidence", type: "numeric", nullable: true })
  compositeConfidence!: number | null;

  @Column({ type: "text" })
  recommendation!: "contact" | "maybe" | "reject";

  @Column({ name: "needs_review", type: "boolean", default: false })
  needsReview!: boolean;

  @Column({ name: "review_reason", type: "text", nullable: true })
  reviewReason!: string | null;

  // full Jev response (incl. usage.cost and request id), kept for audit
  @Column({ name: "raw_answers", type: "jsonb" })
  rawAnswers!: Record<string, unknown>;

  // sha256 of exactly what was sent to Jev (model + state + questions) — a
  // later request with the same hash reuses this result instead of paying
  // for an identical call. Null on rows written before this existed.
  @Column({ name: "input_hash", type: "text", nullable: true })
  inputHash!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
