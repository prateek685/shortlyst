import "dotenv/config";
import { DataSource } from "typeorm";
import { Candidate } from "./entities/candidate.entity";
import { ClassificationResultEntity } from "./entities/classification-result.entity";
import { RoleEntity } from "../requirements/entities/role.entity";
import { RoleDimensionEntity } from "../requirements/entities/role-dimension.entity";
import { RoleMustHaveEntity } from "../requirements/entities/role-must-have.entity";

// Used both by the Nest app (via typeOrmConfig below) and by scripts/migrate.ts
// (TypeORM CLI needs a plain DataSource to run/generate migrations against).
export const dataSourceOptions = {
  type: "postgres" as const,
  url: process.env.DATABASE_URL,
  entities: [Candidate, ClassificationResultEntity, RoleEntity, RoleDimensionEntity, RoleMustHaveEntity],
  migrations: [__dirname + "/migrations/*.{ts,js}"],
  synchronize: false, // schema changes only ever go through migrations, never auto-sync
};

export const AppDataSource = new DataSource(dataSourceOptions);
