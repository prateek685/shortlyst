import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { RoleDimensionEntity } from "./entities/role-dimension.entity";
import { RoleMustHaveEntity } from "./entities/role-must-have.entity";
import { RoleEntity } from "./entities/role.entity";
import type { RoleRequirements } from "./types";
import { validateRoleRequirements } from "./validate";

export { InvalidRoleRequirementsError, validateRoleRequirements } from "./validate";

export interface RoleImportSummary {
  imported: string[];
  skipped: { roleId: string; reason: string }[];
}

@Injectable()
export class RolesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RoleEntity) private readonly roles: Repository<RoleEntity>,
    @InjectRepository(RoleDimensionEntity) private readonly dimensions: Repository<RoleDimensionEntity>,
    @InjectRepository(RoleMustHaveEntity) private readonly mustHaves: Repository<RoleMustHaveEntity>,
  ) {}

  async loadRole(roleId: string): Promise<RoleRequirements> {
    const role = await this.roles.findOne({ where: { roleId } });
    if (!role) {
      throw new Error(`Unknown roleId "${roleId}"`);
    }
    const [dims, mhs] = await Promise.all([
      this.dimensions.find({ where: { role: { id: role.id } } }),
      this.mustHaves.find({ where: { role: { id: role.id } } }),
    ]);
    const requirements = this.toRoleRequirements(role, dims, mhs);
    validateRoleRequirements(requirements);
    return requirements;
  }

  /** A role that fails validation is logged and excluded rather than
   * breaking the whole listing for every other role. */
  async listRoles(): Promise<{ roleId: string }[]> {
    const roles = await this.roles.find();
    const valid: { roleId: string }[] = [];
    for (const role of roles) {
      const [dims, mhs] = await Promise.all([
        this.dimensions.find({ where: { role: { id: role.id } } }),
        this.mustHaves.find({ where: { role: { id: role.id } } }),
      ]);
      try {
        validateRoleRequirements(this.toRoleRequirements(role, dims, mhs));
        valid.push({ roleId: role.roleId });
      } catch (err) {
        console.warn(`[roles] skipping invalid role "${role.roleId}": ${(err as Error).message}`);
      }
    }
    return valid;
  }

  // Upserts each role by role_id, then deletes and reinserts its full set of
  // dimensions/must-haves — see the plan's "delete-and-reinsert per role"
  // decision: makes re-import idempotent (no duplicate rows), makes a
  // dimension removed from the sheet actually disappear from the DB, and
  // structurally can't let one role's criteria bleed into another's (the
  // delete+insert is scoped to exactly one role's id via the FK).
  async importRoles(parsedRoles: RoleRequirements[]): Promise<RoleImportSummary> {
    const imported: string[] = [];
    const skipped: { roleId: string; reason: string }[] = [];

    for (const role of parsedRoles) {
      try {
        validateRoleRequirements(role);
      } catch (err) {
        skipped.push({ roleId: role.roleId || "(blank)", reason: (err as Error).message });
        continue;
      }

      await this.dataSource.transaction(async (manager) => {
        let roleRow = await manager.findOne(RoleEntity, { where: { roleId: role.roleId } });
        if (roleRow) {
          roleRow.contactThreshold = role.thresholds.contact;
          roleRow.rejectThreshold = role.thresholds.reject;
          roleRow.confidenceFloor = role.thresholds.confidenceFloor;
          roleRow = await manager.save(roleRow);
        } else {
          roleRow = await manager.save(
            manager.create(RoleEntity, {
              roleId: role.roleId,
              contactThreshold: role.thresholds.contact,
              rejectThreshold: role.thresholds.reject,
              confidenceFloor: role.thresholds.confidenceFloor,
            }),
          );
        }

        await manager.delete(RoleDimensionEntity, { role: { id: roleRow.id } });
        await manager.delete(RoleMustHaveEntity, { role: { id: roleRow.id } });

        if (role.dimensions.length > 0) {
          await manager.save(
            RoleDimensionEntity,
            role.dimensions.map((d) =>
              manager.create(RoleDimensionEntity, {
                role: roleRow,
                dimensionId: d.id,
                instructions: d.instructions,
                weight: d.weight,
                levels: d.levels,
              }),
            ),
          );
        }
        if (role.mustHaves.length > 0) {
          await manager.save(
            RoleMustHaveEntity,
            role.mustHaves.map((m) =>
              manager.create(RoleMustHaveEntity, {
                role: roleRow,
                mustHaveId: m.id,
                instructions: m.instructions,
              }),
            ),
          );
        }
      });

      imported.push(role.roleId);
    }

    return { imported, skipped };
  }

  // Postgres numeric columns come back from the driver as strings (not JS
  // numbers, to avoid silent precision loss) — Number(...) here is
  // deliberate, not a stray cast.
  private toRoleRequirements(
    role: RoleEntity,
    dims: RoleDimensionEntity[],
    mustHaves: RoleMustHaveEntity[],
  ): RoleRequirements {
    return {
      roleId: role.roleId,
      dimensions: dims.map((d) => ({
        id: d.dimensionId,
        instructions: d.instructions,
        weight: Number(d.weight),
        levels: d.levels,
      })),
      mustHaves: mustHaves.map((m) => ({ id: m.mustHaveId, instructions: m.instructions })),
      thresholds: {
        contact: Number(role.contactThreshold),
        reject: Number(role.rejectThreshold),
        confidenceFloor: Number(role.confidenceFloor),
      },
    };
  }
}
