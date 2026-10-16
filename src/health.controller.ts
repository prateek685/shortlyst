import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";

// Unauthenticated liveness check for deploy.sh and hosting platforms:
// up only when the database answers too.
@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: "ok" }> {
    try {
      await this.dataSource.query("select 1");
    } catch {
      throw new ServiceUnavailableException("database unreachable");
    }
    return { status: "ok" };
  }
}
