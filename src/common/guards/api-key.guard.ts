import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers["x-api-key"];
    const expected = process.env.SHORTLYST_API_KEY;

    if (!expected) {
      // Fail closed: an unset key on the server side is a misconfiguration,
      // not an "allow everything" state.
      throw new UnauthorizedException("API key is not configured on the server");
    }
    if (provided !== expected) {
      throw new UnauthorizedException("Invalid or missing x-api-key header");
    }
    return true;
  }
}
