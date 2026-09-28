import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { RoleEntity } from "./role.entity";

@Entity({ name: "role_must_haves" })
@Unique(["role", "mustHaveId"])
export class RoleMustHaveEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @ManyToOne(() => RoleEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "role_id" })
  role!: RoleEntity;

  @Column({ name: "must_have_id", type: "text" })
  mustHaveId!: string;

  @Column({ type: "text" })
  instructions!: string;
}
