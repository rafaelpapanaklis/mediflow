import "server-only";

/**
 * Wrapper Anthropic Claude para:
 * - AI assistant chat (streaming).
 * - Audio-to-SOAP (transcript → JSON con S/O/A/P estructurado).
 * - Analyze x-ray (vision con imagen + prompt clínico).
 *
 * Stub: si no hay ANTHROPIC_API_KEY devuelve mock.
 *
 * Modelo recomendado: claude-sonnet-4-6 (best price/perf).
 */

const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  model?: string;
}

export interface ChatResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  mock?: boolean;
  error?: string;
}

/** Chat sin streaming (texto completo). */
export async function chat(input: ChatInput): Promise<ChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      text: "[Mock] Claude no está configurado. Configura ANTHROPIC_API_KEY en Vercel.",
      mock: true,
    };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        max_tokens: input.maxTokens ?? 1024,
        ...(input.system ? { system: input.system } : {}),
        messages: input.messages,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { text: "", error: `claude_${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    const textBlocks = (data.content ?? []) as Array<{ type: string; text?: string }>;
    return {
      text: textBlocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"),
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : "chat_failed" };
  }
}

/**
 * Streaming SSE para AI assistant. Devuelve un ReadableStream con eventos
 * "data: {...}\n\n". El consumer (route handler) lo pasa al client tal cual.
 *
 * Stub: si no hay key, devuelve un stream con un solo chunk mock.
 */
export async function chatStream(input: ChatInput): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const encoder = new TextEncoder();

  if (!apiKey) {
    return new ReadableStream({
      start(controller) {
        const mockText = "[Mock] Claude no está configurado. Configura ANTHROPIC_API_KEY.";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { text: mockText } })}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      },
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MODEL,
      max_tokens: input.maxTokens ?? 1024,
      stream: true,
      ...(input.system ? { system: input.system } : {}),
      messages: input.messages,
    }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    return new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: `claude_${res.status}: ${txt.slice(0, 200)}` })}\n\n`),
        );
        controller.close();
      },
    });
  }
  return res.body;
}

/**
 * Convierte un transcript de audio a un objeto SOAP estructurado usando
 * Claude. Devuelve { subjective, objective, assessment, plan } o error.
 */
export async function transcriptToSoap(transcript: string): Promise<{
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  error?: string;
}> {
  const result = await chat({
    system: `Eres un asistente clínico que organiza transcripciones de consultas médicas en formato SOAP.
Devuelve ÚNICAMENTE un objeto JSON válido con las claves "subjective", "objective", "assessment", "plan".
Si una sección no aparece en el transcript, deja el string vacío. NO incluyas markdown, código, ni texto adicional.`,
    messages: [
      { role: "user", content: `Transcripción de la consulta:\n\n${transcript}\n\nDevuelve el SOAP en JSON.` },
    ],
    maxTokens: 1500,
  });
  if (result.error) {
    return { subjective: "", objective: "", assessment: "", plan: "", error: result.error };
  }
  try {
    // Extraemos el primer { ... } del response (Claude a veces envuelve en
    // markdown a pesar del system prompt).
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no_json_in_response");
    const parsed = JSON.parse(match[0]) as Record<string, string>;
    return {
      subjective: parsed.subjective ?? "",
      objective: parsed.objective ?? "",
      assessment: parsed.assessment ?? "",
      plan: parsed.plan ?? "",
    };
  } catch (err) {
    return {
      subjective: "", objective: "", assessment: "", plan: "",
      error: err instanceof Error ? err.message : "parse_failed",
    };
  }
}
