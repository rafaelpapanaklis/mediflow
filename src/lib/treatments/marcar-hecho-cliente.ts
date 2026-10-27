// «Marcar hecho» desde las pantallas de A (ws1-t12 · fase 2): «Hoy en el sillón» al completar la
// consulta. La ACCIÓN es de ws1-t5 (fase 2 · B: hecho → odontograma con deshacer y bitácora) en
// PATCH /api/treatments/[id]; aquí solo se llama. Si el contrato definitivo es otro, se cambia aquí y
// en ningún otro sitio.
//
// Contrato (el de B, `lib/treatments/aplicar-hecho.server.ts`): `{ action: "marcar_hecho", itemIds,
// citaId? }`, una petición por PLAN con todas sus filas (una transacción y una fila de bitácora). Se
// da por hecho si la respuesta trae las filas (`items`; también `fila`/`item` o `estado: "hecho"`).
//
// ⚠ Un PATCH de antes de B no conoce la acción y la trata como «edición general» del plan: contesta
// `{ success: true }` SIN marcar nada. Eso aquí es «no disponible», nunca un éxito.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const ACCION_MARCAR_HECHO = "marcar_hecho";

/**
 * v11 (27-oct, Rafael): un plan CERRADO («Cerrar plan» lo deja Abandonado) no se marca ni se deshace.
 * La tarjeta esconde los botones; el servidor lo vuelve a mirar con el plan bloqueado.
 */
export const ESTADOS_DE_PLAN_SIN_HECHO: readonly string[] = ["ABANDONED"];

export const RUTA_MARCAR_HECHO = (planId: string) => `/api/treatments/${encodeURIComponent(planId)}`;

export interface ResultadoMarcarHecho {
  ok: boolean;
  /** La API no conoce la acción todavía (B sin integrar). */
  noDisponible?: boolean;
  error?: string;
  status?: number;
  /** Deshacer: a qué estado volvió la fila (`pendiente` o `en_curso`). */
  estado?: string;
  /** Lo que pasó con el odontograma (o con el deshacer), en palabras, para el aviso. */
  mensaje?: string;
}

export function cuerpoMarcarHecho(filaIds: string[], citaId: string | null) {
  return { action: ACCION_MARCAR_HECHO, itemIds: filaIds, ...(citaId ? { citaId } : {}) };
}

export async function marcarHecho(planId: string, filaIds: string[], citaId: string | null, f: Fetch = fetch): Promise<ResultadoMarcarHecho> {
  let res: Response;
  try {
    res = await f(RUTA_MARCAR_HECHO(planId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoMarcarHecho(filaIds, citaId)),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  let data: Record<string, unknown> = {};
  try {
    const d = await res.json();
    if (d && typeof d === "object") data = d as Record<string, unknown>;
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok) return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : undefined };
  const marcada = !!data.fila || !!data.item || Array.isArray(data.items) || data.estado === "hecho";
  const resultados = Array.isArray(data.odontograma) ? (data.odontograma as Array<{ mensaje?: unknown }>) : [];
  const mensaje = resultados.length === 1 && typeof resultados[0]?.mensaje === "string" ? resultados[0].mensaje : undefined;
  return marcada ? { ok: true, status: res.status, ...(mensaje ? { mensaje } : {}) } : { ok: false, noDisponible: true, status: res.status };
}

export const ACCION_DESHACER_HECHO = "deshacer_hecho";

/**
 * v11 (27-oct): «Deshacer» desde la tarjeta del plan — la fila vuelve a «por hacer» (o «en curso») y
 * el odontograma a como estaba; lo que se debe baja. El mismo PATCH, `{ action: "deshacer_hecho", itemId }`.
 */
export async function deshacerHecho(planId: string, filaId: string, f: Fetch = fetch): Promise<ResultadoMarcarHecho> {
  let res: Response;
  try {
    res = await f(RUTA_MARCAR_HECHO(planId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: ACCION_DESHACER_HECHO, itemId: filaId }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  let data: Record<string, unknown> = {};
  try {
    const d = await res.json();
    if (d && typeof d === "object") data = d as Record<string, unknown>;
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok) return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : undefined };
  if (!data.item) return { ok: false, noDisponible: true, status: res.status };
  const conflictos = (data.odontograma as { conflictos?: Array<{ mensaje?: unknown }> } | undefined)?.conflictos ?? [];
  const avisos = conflictos.map((c) => c?.mensaje).filter((m): m is string => typeof m === "string");
  const base = typeof data.mensaje === "string" ? data.mensaje : undefined;
  const mensaje = [base, ...avisos].filter(Boolean).join(" ");
  return {
    ok: true,
    status: res.status,
    ...(typeof data.estado === "string" ? { estado: data.estado } : {}),
    ...(mensaje ? { mensaje } : {}),
  };
}
