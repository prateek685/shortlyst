import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

export type MailMessageStatus = "queued" | "processing" | "done" | "skipped" | "failed";

// One row per provider message ever seen — the record that makes processing
// idempotent (unique per connection) and the source of the backlog/lag
// numbers shown in the options page.
@Entity({ name: "mail_messages" })
@Unique(["connectionId", "providerMessageId"])
export class MailMessageEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "connection_id", type: "uuid" })
  connectionId!: string;

  @Column({ name: "provider_message_id", type: "text" })
  providerMessageId!: string;

  @Column({ name: "thread_id", type: "uuid" })
  threadId!: string;

  // Filled when the thread is fetched for processing (the sync step only
  // knows ids).
  @Column({ name: "from_email", type: "text", nullable: true })
  fromEmail!: string | null;

  @Column({ name: "from_name", type: "text", nullable: true })
  fromName!: string | null;

  @Column({ type: "text", nullable: true })
  subject!: string | null;

  @Column({ name: "received_at", type: "timestamptz", nullable: true })
  receivedAt!: Date | null;

  @Column({ type: "text", default: "queued" })
  status!: MailMessageStatus;

  @Column({ name: "skip_reason", type: "text", nullable: true })
  skipReason!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
