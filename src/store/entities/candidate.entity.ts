import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "candidates" })
export class Candidate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // nullable + unique: Postgres allows multiple NULLs under a unique constraint,
  // so this is "unique when present" without needing a partial index.
  @Column({ name: "external_id", type: "text", nullable: true, unique: true })
  externalId!: string | null;

  @Column({ type: "text" })
  source!: "manual" | "linkedin" | "email";

  @Column({ name: "profile_text", type: "text" })
  profileText!: string;

  @Column({ name: "structured_profile", type: "jsonb", nullable: true })
  structuredProfile!: Record<string, unknown> | null;

  // Identity fields — scraped by the extension but never persisted before
  // this pass; needed so a later "export the current shortlist" action has
  // something to show beyond a bare LinkedIn URL.
  @Column({ type: "text", nullable: true })
  name!: string | null;

  @Column({ type: "text", nullable: true })
  headline!: string | null;

  @Column({ type: "text", nullable: true })
  location!: string | null;

  @Column({ name: "photo_url", type: "text", nullable: true })
  photoUrl!: string | null;

  // The candidate's email address — the sender, for candidates who arrived
  // by email.
  @Column({ type: "text", nullable: true })
  email!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
