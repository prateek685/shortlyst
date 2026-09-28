import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RoleDimensionEntity } from "./entities/role-dimension.entity";
import { RoleMustHaveEntity } from "./entities/role-must-have.entity";
import { RoleEntity } from "./entities/role.entity";
import { RolesService } from "./roles.service";

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, RoleDimensionEntity, RoleMustHaveEntity])],
  providers: [RolesService],
  exports: [RolesService],
})
export class RequirementsModule {}
