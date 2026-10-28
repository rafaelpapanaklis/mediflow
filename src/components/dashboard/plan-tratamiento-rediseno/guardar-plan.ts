/**
 * Guardar el plan de la ventana rápida (ws1-t5, fase 2 · P3) — el ÚNICO sitio de esta carpeta
 * que escribe. Las ventanas (`.tsx`) no llaman a la API: llaman aquí.
 *
 * Por qué la ventana guarda ella misma y no el padre: el `handleCreateTreatment` de la ficha manda
 * los siete campos de siempre y no sabe de filas. Aquí se manda lo MISMO (con el texto del plan
 * en `description`, como hoy) y además `items`, las filas del contrato de t12 (`items.ts`):
 *  · si la API ya guarda filas, contesta el plan con `items` → se guardaron filas;
 *  · si no (API de antes de P2, o el SQL de filas sin aplicar), ignora `items` y guarda el texto:
 *    el plan queda como hoy, sin error. El lector dual de t12 lee filas si hay y texto si no.
 *
 * «Guardar y presentar» llama a P4 de t12 en `RUTA_PRESENTAR` (ws1-t12 · fase 2: ya existe,
 * `api/treatments/[id]/presentar`). Si una versión sin esa ruta contesta 404, el botón dice «Pronto».
 */
import { CLAVE_DE_CODIGO, type CodigoDeFila, type FilaDto } from "@/lib/treatments/items";
import type { FilaParaGuardar, OtroPlan } from "./armar-plan";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** P4 (t12). Si la ruta definitiva es otra, se cambia aquí y en ningún otro sitio. */
export const RUTA_PRESENTAR = (planId: string) => `/api/treatments/${encodeURIComponent(planId)}/presentar`;

export interface AltaDePlan {
  patientId: string;
  doctorId: string;
  name: string;
  /** El plan como texto (`componerDescripcion`): lo que se guarda hoy y lo que lee un plan sin filas. */
  description: string | null;
  totalSessions: number;
  sessionIntervalDays: number;
  totalCost: number;
  confirmarSinCosto: boolean;
  items: FilaParaGuardar[];
}

export interface ResultadoGuardar {
  ok: boolean;
  /** El plan que contestó la API (con su `id`). */
  plan?: { id: string; items?: FilaDto[] } & Record<string, unknown>;
  /** «filas»: la API guardó las filas; «texto»: guardó como hoy. */
  modo?: "filas" | "texto";
  /** Clave i18n del error de una fila (contrato) y su número (desde 1), o el texto que mandó la API. */
  claveError?: string;
  fila?: number;
  error?: string;
  status?: number;
}

async function leerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const d = await res.json();
    return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** El cuerpo del POST: los campos de siempre + `items`. */
export function cuerpoDeAlta(a: AltaDePlan): Record<string, unknown> {
  return {
    patientId: a.patientId,
    doctorId: a.doctorId,
    name: a.name.trim(),
    description: a.description?.trim() || null,
    totalSessions: Math.max(1, Math.round(a.totalSessions) || 1),
    sessionIntervalDays: Math.max(1, Math.round(a.sessionIntervalDays) || 30),
    totalCost: Math.max(0, a.totalCost || 0),
    ...(a.confirmarSinCosto ? { confirmarSinCosto: true } : {}),
    items: a.items,
  };
}

export async function guardarPlan(a: AltaDePlan, f: Fetch = fetch): Promise<ResultadoGuardar> {
  let res: Response;
  try {
    res = await f("/api/treatments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoDeAlta(a)),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  const data = await leerJson(res);
  if (!res.ok) {
    const code = typeof data.code === "string" ? data.code : "";
    if (code in CLAVE_DE_CODIGO) {
      const indice = typeof data.indice === "number" && data.indice >= 0 ? data.indice + 1 : undefined;
      return { ok: false, status: res.status, claveError: CLAVE_DE_CODIGO[code as CodigoDeFila], fila: indice };
    }
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : undefined };
  }
  if (typeof data.id !== "string") return { ok: false, status: res.status };
  return {
    ok: true,
    status: res.status,
    plan: data as ResultadoGuardar["plan"],
    // La API de P2 contesta `items: []` también cuando NO guardó filas (sin el SQL): lo dice `filasGuardadas`.
    modo: data.filasGuardadas === true || (data.filasGuardadas === undefined && Array.isArray(data.items) && data.items.length > 0) ? "filas" : "texto",
  };
}

/** ¿Ya existe «presentar» (P4)? Un OPTIONS no escribe: Next lo contesta solo si la ruta existe. */
/**
 * Los planes activos (o en pausa) del paciente con sus filas (ws1-t6 v2, M1): lo marcado en rojo que
 * ya está en uno de ellos no se ofrece otra vez en «Nuevo plan». Solo LEE (`GET /api/treatments`,
 * `treatments.view`; un doctor ve sus planes). Si falla, lista vacía: la ventana sigue como antes.
 */
export async function planesActivosDelPaciente(patientId: string, f: Fetch = fetch): Promise<OtroPlan[]> {
  try {
    const r = await f(`/api/treatments?patientId=${encodeURIComponent(patientId)}`, { cache: "no-store" });
    const d = r.ok ? await r.json() : [];
    if (!Array.isArray(d)) return [];
    return d
      .filter((p) => (p?.status === "ACTIVE" || p?.status === "PAUSED") && Array.isArray(p.items) && p.items.length > 0)
      .map((p) => ({ planId: String(p.id), nombre: String(p.name ?? ""), filas: p.items }));
  } catch {
    return [];
  }
}

export async function presentarDisponible(f: Fetch = fetch): Promise<boolean> {
  try {
    const res = await f(RUTA_PRESENTAR("_"), { method: "OPTIONS" });
    return res.status !== 404;
  } catch {
    return false;
  }
}

export interface ResultadoPresentar {
  ok: boolean;
  /** La ruta no existe todavía (P4 pendiente). */
  pronto?: boolean;
  quoteId?: string;
  folio?: string;
  enlaceFirma?: string;
  error?: string;
}

export async function presentarPlan(planId: string, f: Fetch = fetch): Promise<ResultadoPresentar> {
  let res: Response;
  try {
    res = await f(RUTA_PRESENTAR(planId), { method: "POST" });
  } catch {
    return { ok: false };
  }
  // La ruta que no existe la contesta Next con su página 404 (HTML), no con el JSON de la API:
  // un 404 en JSON es de la ruta (p. ej. el plan no se encontró) y se dice como error.
  const esJson = (res.headers?.get?.("content-type") ?? "").includes("json");
  if (res.status === 405 || (res.status === 404 && !esJson)) return { ok: false, pronto: true };
  const data = await leerJson(res);
  if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : undefined };
  const texto = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : undefined);
  return { ok: true, quoteId: texto("quoteId"), folio: texto("folio"), enlaceFirma: texto("enlaceFirma") };
}
