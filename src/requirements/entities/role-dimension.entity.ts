import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { RoleEntity } from "./role.entity";

// Unique on (role_id, dimension_id) is what makes re-import idempotent — an
// import never creates a second row for the same dimension of the same
// role; roles.service.ts instead deletes-and-reinserts a role's full set on
// every import, which this constraint keeps honest.
@Entity({ name: "role_dimensions" })
@Unique(["role", "dimensionId"])
export class RoleDimensionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @ManyToOne(() => RoleEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "role_id" })
  role!: RoleEntity;

  @Column({ name: "dimension_id", type: "text" })
  dimensionId!: string;

  @Column({ type: "text" })
  instructions!: string;

  @Column({ type: "numeric" })
  weight!: number;

  // ordered rubric levels, 2-10 entries — see validateRoleRequirements
  @Column({ type: "jsonb" })
  levels!: string[];
}
