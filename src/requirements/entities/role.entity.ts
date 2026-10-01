import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "roles" })
export class RoleEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "role_id", type: "text", unique: true })
  roleId!: string;

  @Column({ name: "contact_threshold", type: "numeric" })
  contactThreshold!: number;

  @Column({ name: "reject_threshold", type: "numeric" })
  rejectThreshold!: number;

  @Column({ name: "confidence_floor", type: "numeric" })
  confidenceFloor!: number;

  // One line describing the role, from the Roles sheet's thresholds tab —
  // what the mail triage's role "choice" shows Jev for this role.
  @Column({ type: "text", nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
