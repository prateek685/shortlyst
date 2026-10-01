import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity({ name: "mail_connections" })
@Unique(["provider", "mailboxAddress"])
export class MailConnectionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  provider!: string;

  @Column({ name: "mailbox_address", type: "text" })
  mailboxAddress!: string;

  // AES-256-GCM, see credentials-crypto.ts — never stored in plaintext.
  @Column({ name: "credentials_enc", type: "text" })
  credentialsEnc!: string;

  @Column({ type: "text", default: "connected" })
  status!: "connected" | "disconnected";

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  // Opaque to everything but the provider adapter (Gmail: a historyId).
  // Null until the first sync, which backfills by date and then sets it.
  @Column({ type: "text", nullable: true })
  cursor!: string | null;

  // When the last successful listing started — the fallback search looks
  // back from here (minus an hour of overlap).
  @Column({ name: "last_synced_at", type: "timestamptz", nullable: true })
  lastSyncedAt!: Date | null;

  // When a sync last ran, successful or not — shown in the options page.
  @Column({ name: "last_sync_at", type: "timestamptz", nullable: true })
  lastSyncAt!: Date | null;

  @Column({ name: "provider_state", type: "jsonb", default: () => "'{}'" })
  providerState!: Record<string, unknown>;

  @CreateDateColumn({ name: "connected_at", type: "timestamptz" })
  connectedAt!: Date;
}
