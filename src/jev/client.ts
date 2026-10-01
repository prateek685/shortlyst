import {
  TypeSafeClient,
  choice,
  noul,
  score,
  type Questions,
  type SystemOneResult,
  type Usage,
  type EntryType,
} from "@typesafe-ai/sdk";
import type { LangfuseTraceClient } from "langfuse";

export { choice, noul, score };
export type { Questions };

// Lazily constructed so importing pure helpers (noul/score) — e.g. from
// buildQuestions.ts in a unit test — never requires OPENROUTER_API_KEY to be
// set. Only askJev() actually needs a real client.
let client: TypeSafeClient | undefined;

function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api",
      defaultModel: process.env.JEV_MODEL_ID ?? "typesafe/jev-1.13",
    });
  }
  return client;
}

// OpenRouter adds `usage.cost`, a top-level `id`, and `provider` on top of what
// @typesafe-ai/sdk's SystemOneResult models (verified live via Postman) — captured
// loosely here since raw_answers needs the full response, not just the typed subset.
interface JevUsage extends Usage {
  cost?: number;
}

export interface JevResult<Q extends Questions> extends SystemOneResult<Q> {
  id?: string;
  provider?: string;
  usage: JevUsage;
}

/**
 * `trace` is optional so this function stays usable without Langfuse configured
 * (e.g. a one-off script). When present, the call is recorded as a child
 * `generation` observation on it — model, input, output, usage, and cost.
 */
export async function askJev<const Q extends Questions>(
  state: string | Record<string, unknown>,
  questions: Q,
  trace?: LangfuseTraceClient,
): Promise<JevResult<Q>> {
  const model = process.env.JEV_MODEL_ID ?? "typesafe/jev-1.13";
  const generation = trace?.generation({
    name: "jev-call",
    model,
    input: { state, questions },
  });

  try {
    const result = await getClient().systemOne({
      state: state as EntryType,
      questions,
    });
    const jevResult = result as unknown as JevResult<Q>;

    generation?.end({
      output: jevResult.answers,
      // `usage` (not usageDetails/costDetails — those are v3+ only and get
      // silently dropped by our self-hosted v2 server).
      usage: {
        input: jevResult.usage.input_tokens,
        output: jevResult.usage.output_tokens,
        ...(jevResult.usage.cost !== undefined
          ? { totalCost: jevResult.usage.cost }
          : {}),
      },
      metadata: { requestId: jevResult.id, provider: jevResult.provider },
    });

    return jevResult;
  } catch (err) {
    generation?.end({
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
