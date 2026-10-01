import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyGuard } from "../common/guards/api-key.guard";
import { decryptCredentials, encryptCredentials } from "./credentials-crypto";
import { MailQueueService } from "./mail-queue.service";
import { ConnectionStatus, MailStore, RecentThread } from "./mail.store";
import { createOAuthState, InvalidOAuthStateError, verifyOAuthState } from "./oauth-state";
import type { MailProvider } from "./provider";
import { getProvider, listProviders } from "./providers";

function resolveProvider(type: string): MailProvider {
  let provider: MailProvider;
  try {
    provider = getProvider(type);
  } catch {
    throw new NotFoundException(`Unknown mail provider "${type}"`);
  }
  if (!provider.isConfigured()) throw new BadRequestException(`Mail provider "${type}" is not configured on the server`);
  return provider;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function resultPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shortlyst — ${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6fa;color:#1b1f33;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #dde0ec;border-radius:12px;padding:32px 40px;max-width:480px}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#535a73;line-height:1.5}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

@Controller("mail")
export class MailController {
  constructor(
    private readonly store: MailStore,
    private readonly queue: MailQueueService,
  ) {}

  /** Which providers the "Connect mailbox" button can offer. */
  @Get("providers")
  @UseGuards(ApiKeyGuard)
  providers(): { type: string; displayName: string; configured: boolean }[] {
    return listProviders().map((p) => ({ type: p.type, displayName: p.displayName, configured: p.isConfigured() }));
  }

  @Post("connections/:provider/connect-url")
  @UseGuards(ApiKeyGuard)
  connectUrl(@Param("provider") type: string): { url: string } {
    const provider = resolveProvider(type);
    return { url: provider.authUrl(createOAuthState(provider.type)) };
  }

  // Not behind the API key: the provider redirects the user's browser here.
  // The signed `state` is what proves the flow was started by our endpoint.
  @Get("oauth/:provider/callback")
  @Header("Content-Type", "text/html; charset=utf-8")
  async callback(
    @Param("provider") type: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
  ): Promise<string> {
    if (error) return resultPage("Not connected", `The provider returned: ${error}. You can close this tab and try again.`);
    if (!code || !state) return resultPage("Not connected", "The sign-in response was incomplete. Please try again.");

    let provider: MailProvider;
    try {
      provider = resolveProvider(type);
      verifyOAuthState(state, provider.type);
    } catch (err) {
      const reason = err instanceof InvalidOAuthStateError ? err.message : (err as Error).message;
      return resultPage("Not connected", `${reason}. Start again from the Shortlyst options page.`);
    }

    try {
      const { credentials, mailbox } = await provider.exchangeCode(code);
      const connectionId = await this.store.upsertConnection(provider.type, mailbox, encryptCredentials(credentials));
      await this.queue.enqueueSync(connectionId).catch(() => undefined);
      return resultPage("Mailbox connected", `${mailbox} is connected to Shortlyst. You can close this tab.`);
    } catch (err) {
      return resultPage("Not connected", `Connecting failed: ${(err as Error).message}`);
    }
  }

  @Get("connections")
  @UseGuards(ApiKeyGuard)
  connections(): Promise<ConnectionStatus[]> {
    return this.store.listConnectionStatuses();
  }

  @Get("threads")
  @UseGuards(ApiKeyGuard)
  threads(@Query("limit") limit?: string): Promise<RecentThread[]> {
    const parsed = Number(limit ?? 50);
    return this.store.listRecentThreads(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50);
  }

  @Post("connections/:id/sync")
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  async syncNow(@Param("id") id: string): Promise<{ queued: true }> {
    if (!(await this.store.getConnection(id))) throw new NotFoundException("Unknown mailbox connection");
    await this.queue.enqueueSync(id);
    return { queued: true };
  }

  @Post("retry-failed")
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  async retryFailed(): Promise<{ requeued: number }> {
    const requeued = await this.store.requeueFailed();
    for (const { id } of await this.store.listConnectedIds()) {
      await this.queue.enqueueSync(id);
    }
    return { requeued };
  }

  @Delete("connections/:id")
  @UseGuards(ApiKeyGuard)
  async disconnect(@Param("id") id: string): Promise<{ deleted: true }> {
    const connection = await this.store.getConnection(id);
    if (!connection) throw new NotFoundException("Unknown mailbox connection");
    try {
      await getProvider(connection.provider).revoke(decryptCredentials(connection.credentialsEnc));
    } catch {
      // Best effort — the connection is removed either way.
    }
    await this.store.deleteConnection(id);
    return { deleted: true };
  }
}
