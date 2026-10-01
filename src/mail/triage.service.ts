import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { askJev } from "../jev/client";
import { getLangfuse } from "../observability/langfuse";
import { MailStore } from "./mail.store";
import { buildTriageQuestions, readTriageAnswers, type OpenRole, type TriageAnswers } from "./triage";

// Jev call 1, cached by a fingerprint of exactly what Jev would read (model +
// text + questions) — the same approach as classification's inputHash.ts.
@Injectable()
export class TriageService {
  constructor(private readonly store: MailStore) {}

  async triage(text: string, roles: OpenRole[]): Promise<TriageAnswers> {
    const questions = buildTriageQuestions(roles);
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ model: process.env.JEV_MODEL_ID ?? "typesafe/jev-1.13", state: text, questions }))
      .digest("hex");

    const cached = await this.store.findTriage(inputHash);
    if (cached) return cached;

    const trace = getLangfuse().trace({ name: "mail-triage", input: { roles: roles.map((r) => r.roleId), text } });
    const result = await askJev(text, questions, trace);
    const answers = readTriageAnswers(result.answers as Record<string, unknown>);
    trace.update({ output: answers });

    await this.store.saveTriage(inputHash, answers, result as unknown as Record<string, unknown>);
    return answers;
  }
}
