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

import type { PlanConCuenta } from "./sin-doble-cobro";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const ACCION_MARCAR_HECHO = "marcar_hecho";

/**
 * v11 (27-oct, Rafael): un plan CERRADO («Cerrar plan» lo deja Abandonado) no se marca ni se deshace.
 * La tarjeta esconde los botones; el servidor lo vuelve a mirar con el plan bloqueado.
 */
export const ESTADOS_DE_PLAN_SIN_HECHO: readonly string[] = ["ABANDONED"];

export const RUTA_MARCAR_HECHO = (planId: string) => `/api/treatments/${encodeURIComponent(planId)}`;

// ── v12 (t5, m3): los avisos, en el idioma de la pantalla ─────────────────────────────────────────
// El servidor arma sus textos con el diccionario español. La tarjeta del plan traduce por lo que pasó
// (estado del odontograma, estado al que volvió la fila, motivo del conflicto, código del error) con el
// SUYO. Las claves son las mismas `planTratamiento.hecho.*` que ya usaba el servidor.

type T = (clave: string, vars?: Record<string, string | number>) => string;

/** Lo que pudo pasar con el odontograma al marcar (`EstadoOdontograma` del servidor). */
export const RESULTADOS_DE_HECHO = ["aplicado", "sin_cambio", "sin_permiso", "sin_paciente", "pendiente_de_base", "ya_estaba_hecho"] as const;
/** Los códigos de error de «hecho» (`CODIGOS_HECHO` del servidor es esta misma lista). */
export const CODIGOS_DE_HECHO = [
  "sin_filas", "demasiadas_filas", "fila_desconocida", "fila_cancelada", "no_esta_hecha",
  "cita_invalida", "sin_filas_en_plan", "sin_permiso_odontograma", "plan_cerrado", "motivo_sin_cita",
  // ws1-t6: no se pudo leer el rojo/azul del odontograma; no se tocó nada (503, se puede reintentar)
  "estado_no_disponible",
] as const;

export function avisoDeHecho(t: T, r: Pick<ResultadoMarcarHecho, "resultado">): string {
  const k = (RESULTADOS_DE_HECHO as readonly string[]).includes(r.resultado ?? "") ? r.resultado : "aplicado";
  return t(`planTratamiento.hecho.resultado.${k}`);
}

export function avisoDeDeshacer(
  t: T,
  r: Pick<ResultadoMarcarHecho, "estado" | "conflictos">,
  nombreDeHallazgo: (conditionId: string) => string,
): string {
  const base = t(`planTratamiento.hecho.deshecho.${r.estado === "en_curso" ? "en_curso" : "pendiente"}`);
  const avisos = (r.conflictos ?? [])
    .filter((c) => ["alta_ya_no_esta", "cambio_posterior", "nota_quitada"].includes(c.motivo))
    .map((c) => t(`planTratamiento.hecho.conflicto.${c.motivo}`, { diente: String(c.toothNumber), hallazgo: nombreDeHallazgo(c.conditionId), nota: c.nota ?? "" }));
  return [base, ...avisos].join(" ");
}

/**
 * ¿La ayuda de «Procedimientos» puede decir que lo hecho pasa a «Debe»? Solo si se sabe que el plan
 * cobra lo hecho (cuenta leída y sin cuotas acordadas, v12 m2) Y lo que falta por hacer ya está en una
 * nota de cobro (v13, t5 n1): en un plan sin aceptar, o en filas agregadas después de la nota, «Hecho»
 * no mueve «Debe» (no crea cobros).
 */
export function ayudaHablaDeDebe(debeSigueLoHecho: boolean, filas: ReadonlyArray<{ estado: string; invoiceId: string | null }>): boolean {
  return debeSigueLoHecho && filas.some((f) => f.estado !== "hecho" && f.estado !== "cancelado" && !!f.invoiceId);
}

/**
 * El error en el idioma de la pantalla. Con un código de «hecho», su texto. Sin código (las respuestas
 * de la ruta antes de llegar a «hecho»: permiso, doctor de otro plan, visibilidad del paciente — v13,
 * t5 n2): un 403 dice que falta permiso; lo demás, el genérico DE LA ACCIÓN que se pulsó (marcar o
 * deshacer).
 */
export function errorDeHecho(t: T, r: Pick<ResultadoMarcarHecho, "codigo" | "status">, accion: "marcar" | "deshacer" = "marcar"): string {
  if ((CODIGOS_DE_HECHO as readonly string[]).includes(r.codigo ?? "")) return t(`planTratamiento.hecho.error.${r.codigo}`);
  if (r.status === 403) return t("planTratamiento.hecho.error.sin_permiso");
  return t(accion === "deshacer" ? "planTratamiento.hecho.error.genericoDeshacer" : "planTratamiento.hecho.error.generico");
}

export interface ResultadoMarcarHecho {
  ok: boolean;
  /** La API no conoce la acción todavía (B sin integrar). */
  noDisponible?: boolean;
  error?: string;
  status?: number;
  /** El código del error (`plan_cerrado`, `no_esta_hecha`…): la pantalla lo dice en su idioma. */
  codigo?: string;
  /** Marcar UNA fila: qué pasó con el odontograma (`aplicado`, `sin_cambio`, `sin_permiso`…). */
  resultado?: string;
  /** Deshacer: a qué estado volvió la fila (`pendiente` o `en_curso`). */
  estado?: string;
  /** Deshacer: lo que no se devolvió al odontograma, como datos (la pantalla lo dice en su idioma). */
  conflictos?: ConflictoDelDeshacer[];
  /**
   * v14 (QA de Claude): la cuenta del plan ya cambiada, si el servidor la manda (quien ve dinero). La
   * ficha la pone al momento en «Cuenta del plan» en lugar de esperar a releer todos los planes.
   */
  cuenta?: PlanConCuenta;
  /** v17: la cita elegida no tiene nota clínica (la tarjeta avisa y ofrece escribirla; nada se bloqueó). */
  citaSinNota?: boolean;
}

/** La cuenta que viene en la respuesta de «Hecho», «Deshacer» o «Cerrar plan», si viene bien formada. */
export function cuentaDeLaRespuesta(data: unknown): PlanConCuenta | undefined {
  const c = (data as { cuenta?: unknown } | null)?.cuenta as Partial<PlanConCuenta> | undefined;
  return c && typeof c === "object" && typeof c.planId === "string" && Array.isArray(c.notas) && typeof c.pagado === "number"
    ? (c as PlanConCuenta)
    : undefined;
}

/**
 * v12 (t5, m3): el servidor arma sus textos en español; la pantalla NO los enseña: traduce por estado,
 * por motivo o por código con su propio diccionario. Aquí solo viajan los datos.
 */
export interface ConflictoDelDeshacer {
  motivo: string;
  toothNumber: number;
  conditionId: string;
  nota: string | null;
}

const errorDe = (status: number, data: Record<string, unknown>): ResultadoMarcarHecho => ({
  ok: false,
  status,
  ...(typeof data.error === "string" ? { error: data.error } : {}),
  ...(typeof data.code === "string" ? { codigo: data.code } : {}),
});

/**
 * v15 (t5 de la v14, M3): `conCuenta` pide que la respuesta traiga la cuenta del plan ya cambiada. Lo
 * manda la tarjeta del plan (la pinta al momento); «Hoy en el sillón» no (no la usa y cuesta ~2 s por plan).
 */
export interface OpcionesDeHecho {
  conCuenta?: boolean;
  /** v17 (decisión 1 de Rafael): «Se hizo sin cita», con este motivo (va sin `citaId`). */
  sinCita?: string;
  /** v17: que la respuesta diga si la cita elegida no tiene nota clínica (`citaSinNota`). Lo pide la tarjeta. */
  avisarSinNota?: boolean;
}

export function cuerpoMarcarHecho(filaIds: string[], citaId: string | null, opciones: OpcionesDeHecho = {}) {
  return {
    action: ACCION_MARCAR_HECHO,
    itemIds: filaIds,
    ...(citaId ? { citaId } : opciones.sinCita !== undefined ? { sinCita: true, motivoSinCita: opciones.sinCita } : {}),
    ...(citaId && opciones.avisarSinNota ? { avisarSinNota: true } : {}),
    ...(opciones.conCuenta ? { conCuenta: true } : {}),
  };
}

export async function marcarHecho(
  planId: string,
  filaIds: string[],
  citaId: string | null,
  f: Fetch = fetch,
  opciones: OpcionesDeHecho = {},
): Promise<ResultadoMarcarHecho> {
  let res: Response;
  try {
    res = await f(RUTA_MARCAR_HECHO(planId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoMarcarHecho(filaIds, citaId, opciones)),
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
  if (!res.ok) return errorDe(res.status, data);
  const marcada = !!data.fila || !!data.item || Array.isArray(data.items) || data.estado === "hecho";
  const resultados = Array.isArray(data.odontograma) ? (data.odontograma as Array<{ estado?: unknown }>) : [];
  const resultado = resultados.length === 1 && typeof resultados[0]?.estado === "string" ? resultados[0].estado : undefined;
  const cuenta = cuentaDeLaRespuesta(data);
  return marcada
    ? { ok: true, status: res.status, ...(resultado ? { resultado } : {}), ...(cuenta ? { cuenta } : {}), ...(data.citaSinNota === true ? { citaSinNota: true } : {}) }
    : { ok: false, noDisponible: true, status: res.status };
}

export const ACCION_DESHACER_HECHO = "deshacer_hecho";

/**
 * v11 (27-oct): «Deshacer» desde la tarjeta del plan — la fila vuelve a «por hacer» (o «en curso») y
 * el odontograma a como estaba; lo que se debe baja. El mismo PATCH, `{ action: "deshacer_hecho", itemId }`.
 */
export async function deshacerHecho(planId: string, filaId: string, f: Fetch = fetch, opciones: OpcionesDeHecho = {}): Promise<ResultadoMarcarHecho> {
  let res: Response;
  try {
    res = await f(RUTA_MARCAR_HECHO(planId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: ACCION_DESHACER_HECHO, itemId: filaId, ...(opciones.conCuenta ? { conCuenta: true } : {}) }),
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
  if (!res.ok) return errorDe(res.status, data);
  if (!data.item) return { ok: false, noDisponible: true, status: res.status };
  const crudos = (data.odontograma as { conflictos?: unknown } | undefined)?.conflictos;
  const conflictos: ConflictoDelDeshacer[] = (Array.isArray(crudos) ? crudos : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as any).motivo === "string")
    .map((c) => ({
      motivo: String(c.motivo),
      toothNumber: Number(c.toothNumber),
      conditionId: String(c.conditionId ?? ""),
      nota: typeof c.nota === "string" ? c.nota : null,
    }));
  return {
    ok: true,
    status: res.status,
    ...(typeof data.estado === "string" ? { estado: data.estado } : {}),
    ...(conflictos.length ? { conflictos } : {}),
    ...(cuentaDeLaRespuesta(data) ? { cuenta: cuentaDeLaRespuesta(data) } : {}),
  };
}
