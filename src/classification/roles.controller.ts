import { Body, Controller, Get, InternalServerErrorException, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../common/guards/api-key.guard";
import { parseRolesFromSheetRows } from "../requirements/roles-import.parser";
import { RoleImportSummary, RolesService } from "../requirements/roles.service";
import type { RoleRequirements } from "../requirements/types";
import { InvalidRoleRequirementsError } from "../requirements/validate";
import { ImportRolesDto } from "./dto/import-roles.dto";

@Controller()
@UseGuards(ApiKeyGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("roles")
  list(): Promise<{ roleId: string }[]> {
    return this.roles.listRoles();
  }

  // Same not-found/misconfigured distinction classification.service.ts
  // already makes around this exact call — loadRole() throws a plain Error
  // for "doesn't exist" and InvalidRoleRequirementsError for "exists but
  // fails validation"; both need converting here too, or a bad roleId would
  // 500 instead of 404.
  @Get("roles/:roleId")
  async detail(@Param("roleId") roleId: string): Promise<RoleRequirements> {
    try {
      return await this.roles.loadRole(roleId);
    } catch (err) {
      if (err instanceof InvalidRoleRequirementsError) {
        throw new InternalServerErrorException(`Role "${roleId}" is misconfigured: ${err.message}`);
      }
      throw new NotFoundException(`Unknown roleId "${roleId}"`);
    }
  }

  @Post("roles/import")
  import(@Body() body: ImportRolesDto): Promise<RoleImportSummary> {
    const parsed = parseRolesFromSheetRows(body.dimensionRows, body.mustHaveRows, body.thresholdRows);
    return this.roles.importRoles(parsed);
  }
}
