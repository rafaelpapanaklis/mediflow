import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { persistentRateLimit } from "@/lib/failban";
import { AiScopeError, isAiHistoryStorageMissing, type AiConversationScope } from "./conversations";

/**
 * Piezas compartidas por las cuatro rutas de /api/ai-assistant.
 *
 * Viven aquí y no en un route.ts porque App Router solo admite handlers,
 * `dynamic` y tipos como exports de una ruta: una const suelta rompe el build
 * con "not a valid Route export".
 */

/**
 * NO es una unión discriminada por `ok`. Con `strict: false` en tsconfig,
 * TypeScript no estrecha uniones por un booleano literal, así que
 * `if (!auth.ok) return auth.response` no compilaría. La forma plana —una
 * respuesta lista o null— funciona igual y no depende del estrechamiento.
 */
export interface ScopeResult {
  /** Respuesta que la ruta debe devolver tal cual. `null` = sesión válida. */
  response: NextResponse | null;
  ctx: AuthContext | null;
  scope: AiConversationScope | null;
}

/**
 * Autenticación + dueño del historial, en un solo sitio.
 *
 * El clinicId sale de la SESIÓN (getAuthContext lee la cookie firmada de sede
 * activa y la valida contra `users`), jamás del cuerpo de la petición. El
 * userId es el de la fila `users` de ESA sede.
 *
 * El chequeo explícito de los dos strings no es paranoia decorativa: con
 * `strict: false` en tsconfig, TypeScript no estrecha nada, y un `clinicId`
 * undefined colado en un where de Prisma NO filtra — Prisma descarta la clave y
 * devuelve las filas de todas las clínicas.
 */
export async function resolveAiScope(): Promise<ScopeResult> {
  const unauthorized = (): ScopeResult => ({
    response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    ctx: null,
    scope: null,
  });

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (typeof ctx.clinicId !== "string" || !ctx.clinicId) return unauthorized();
  if (typeof ctx.userId !== "string" || !ctx.userId) return unauthorized();

  return { response: null, ctx, scope: { clinicId: ctx.clinicId, userId: ctx.userId } };
}

/**
 * Freno de ESCRITURA del historial, por persona.
 *
 * Los topes de conversation-core acotan CADA petición (20 000 caracteres × 10
 * turnos), pero no cuántas peticiones caben: una sesión válida podría crear
 * conversaciones sin fin y llenar el disco de la clínica. `/api/ai` ya tiene su
 * freno (10 / 5 min por clínica) porque ahí la factura es de Anthropic; aquí la
 * factura es el almacenamiento.
 *
 * 300 escrituras cada 5 minutos es un sostenido de una por segundo — dos
 * órdenes de magnitud por encima de lo que produce chatear (dos escrituras por
 * mensaje, con /api/ai limitado a 10 mensajes por ese mismo periodo). Va por
 * `userId` y no por clínica para que una recepción ocupada no se frene a sí
 * misma; el userId ya es de una sola sede, así que sigue siendo por tenant.
 * `scope` fijo para que las tres rutas de escritura compartan el mismo cubo.
 */
export function aiHistoryWriteLimit(req: NextRequest, scope: AiConversationScope) {
  return persistentRateLimit(req, {
    scope: "ai-hist-write",
    id: scope.userId,
    limit: 300,
    windowSec: 300,
  });
}

const STORAGE_PENDING_MESSAGE =
  "Falta aplicar sql/ai-assistant-conversations.sql en Supabase: el historial del asistente no se está guardando.";

/**
 * Traduce el fallo de una operación del historial.
 *
 * Tabla/columna ausente (el .sql se aplica A MANO después del deploy) sale como
 * 503 `storage_unavailable` con `storagePending: true`, y la página lo pinta
 * como aviso SIN tumbar el chat: preguntarle a la IA sigue funcionando, lo que
 * no hay es dónde guardarlo. Cualquier otro fallo es un 500 pelado.
 */
export function aiHistoryErrorResponse(e: unknown): NextResponse {
  if (isAiHistoryStorageMissing(e)) {
    return NextResponse.json(
      { error: "storage_unavailable", storagePending: true, message: STORAGE_PENDING_MESSAGE },
      { status: 503 },
    );
  }
  if (e instanceof AiScopeError) {
    // Scope roto = bug de programación, no un caso de negocio. Se corta con 401
    // (nunca se consulta sin dueño) y queda en el log del server.
    console.error("[ai-assistant] scope incompleto", e.message);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  console.error("[ai-assistant] fallo del historial", e);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
