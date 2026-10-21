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

export const RUTA_MARCAR_HECHO = (planId: string) => `/api/treatments/${encodeURIComponent(planId)}`;

export interface ResultadoMarcarHecho {
  ok: boolean;
  /** La API no conoce la acción todavía (B sin integrar). */
  noDisponible?: boolean;
  error?: string;
  status?: number;
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
  return marcada ? { ok: true, status: res.status } : { ok: false, noDisponible: true, status: res.status };
}
