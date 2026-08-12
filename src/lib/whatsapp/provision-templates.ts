// Alta de las plantillas de DaleControl DENTRO de la cuenta de WhatsApp (WABA)
// de cada clínica.
//
// POR QUÉ: las plantillas son POR WABA. La redacción se decide una vez
// (templates-catalog.ts) pero hay que darla de alta en la cuenta de cada
// clínica, con SU token. Hasta hoy eso se le pedía a la clínica por escrito y
// nadie lo hacía: `message_templates` no se llamaba en ninguna parte del repo,
// así que fuera de la ventana de 24 h no salía ni un solo mensaje.
//
// SERVER ONLY (Prisma + red). El `clinicId` viene SIEMPRE de una fuente de
// confianza —la sesión, el WABA id del webhook, el barrido del cron—, nunca del
// body de un request.
//
// EL TOKEN NUNCA SE ESCRIBE EN LOGS. Los console.* de aquí solo llevan
// clinicId, nombre de plantilla y el mensaje que devolvió Meta.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto/envelope";
import { parseWaTemplates, type WaTemplateConfig, type WaTemplateMap } from "./template-config";
import {
  WA_TEMPLATE_CATALOG,
  WA_TEMPLATES_GRAPH_VERSION,
  buildTemplateCreatePayload,
  catalogEntryByName,
  catalogEntryFor,
  checkCatalogEntry,
  describeRejectionReason,
  mapMetaTemplateStatus,
  type WaCatalogEntry,
  type WaTemplateStatus,
} from "./templates-catalog";
import type { WhatsAppSendKind } from "./system-message";

const GRAPH = `https://graph.facebook.com/${WA_TEMPLATES_GRAPH_VERSION}`;

/** Qué pasó con una plantilla concreta. */
export interface ProvisionOutcome {
  kind: WhatsAppSendKind;
  name: string;
  /** Estado con el que quedó registrada, o null si no se pudo ni crear ni leer. */
  status: WaTemplateStatus | null;
  /** `true` si esta corrida la dio de alta en Meta. */
  created: boolean;
  /** `true` si ya existía en la WABA (nombre ocupado) y solo se recuperó. */
  existed: boolean;
  /** Motivo legible cuando no se pudo. */
  error?: string;
}

export interface ProvisionResult {
  /** `false` = no se pudo trabajar con esta clínica (sin WABA, sin token, sin permiso). */
  ok: boolean;
  /** Motivo en español cuando `ok` es false. Se muestra tal cual en el panel. */
  reason?: string;
  outcomes: ProvisionOutcome[];
  /** Mapa final que quedó guardado en `Clinic.waTemplates`. */
  templates: WaTemplateMap;
}

export interface ProvisionOptions {
  /** Tipos concretos. Por defecto: las de utilidad del catálogo. */
  kinds?: readonly WhatsAppSendKind[];
  /** Incluir además la de MARKETING (reseñas). La clínica la activa a mano. */
  includeMarketing?: boolean;
  /** Rehacer también las que ya están aprobadas (no se usa en el flujo normal). */
  force?: boolean;
}

/* ────────────────────────── alta de plantillas ────────────────────────── */

/**
 * Crea en la WABA de la clínica las plantillas del catálogo que le falten.
 *
 * IDEMPOTENTE en los dos sentidos: no vuelve a pedir las que ya están
 * aprobadas o en revisión, y si Meta responde que el nombre ya existe, eso NO
 * es un error — recupera esa plantilla y registra el estado real.
 *
 * Nunca lanza: devuelve el motivo. Se llama desde la conexión (en segundo
 * plano), desde el botón del panel y desde el cron.
 */
export async function provisionClinicTemplates(
  clinicId: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const clinic = await prisma.clinic
    .findUnique({
      where: { id: clinicId },
      select: {
        id: true,
        waBusinessAccountId: true,
        waAccessToken: true,
        waTemplates: true,
      },
    })
    .catch(() => null);

  const current = parseWaTemplates(clinic?.waTemplates ?? null);

  if (!clinic) {
    return { ok: false, reason: "No se encontró la clínica.", outcomes: [], templates: {} };
  }
  if (!clinic.waBusinessAccountId) {
    // Pasa con las clínicas conectadas a mano sin poner el WABA id: tenemos
    // token para ENVIAR pero no sabemos en qué cuenta crear las plantillas.
    return {
      ok: false,
      reason:
        "La conexión de WhatsApp no incluye el identificador de la cuenta (WABA). " +
        "Vuelve a conectar WhatsApp con el botón de Meta para que podamos crear las plantillas.",
      outcomes: [],
      templates: current,
    };
  }
  const token = clinic.waAccessToken ? decryptField(clinic.waAccessToken) ?? clinic.waAccessToken : null;
  if (!token) {
    return {
      ok: false,
      reason: "La clínica no tiene un token de WhatsApp guardado: vuelve a conectar.",
      outcomes: [],
      templates: current,
    };
  }

  const wanted = selectEntries(opts);
  const outcomes: ProvisionOutcome[] = [];
  const patch: WaTemplateMap = {};
  let fatal: string | undefined;

  for (const entry of wanted) {
    const existing = current[entry.kind];
    // Se salta todo lo que hoy sirve o puede servir: aprobada, en revisión, o
    // registrada a mano por la clínica (sin estado). Ese último caso importa:
    // una clínica con SUS plantillas aprobadas no puede perderlas por pulsar el
    // botón. Solo se vuelve a intentar lo que falta o lo que Meta rechazó.
    if (!opts.force && existing && existing.status !== "REJECTED") continue;

    // Guardia de bug propio: un cuerpo que incumple las reglas de Meta gastaría
    // la llamada para volver con un error genérico.
    const invalid = checkCatalogEntry(entry);
    if (invalid) {
      outcomes.push({ kind: entry.kind, name: entry.name, status: null, created: false, existed: false, error: invalid });
      continue;
    }

    const res = await createTemplate(clinic.waBusinessAccountId, token, entry);

    if (res.kind === "ok") {
      patch[entry.kind] = {
        name: entry.name,
        lang: entry.lang,
        status: res.status,
        metaId: res.metaId,
        updatedAt: new Date().toISOString(),
      };
      outcomes.push({
        kind: entry.kind,
        name: entry.name,
        status: res.status,
        created: !res.existed,
        existed: res.existed,
      });
      continue;
    }

    if (res.kind === "fatal") {
      // Falta de permisos o token muerto: las demás fallarían igual. Se corta
      // aquí para no gastar cinco llamadas idénticas ni pintar cinco errores.
      fatal = res.reason;
      outcomes.push({ kind: entry.kind, name: entry.name, status: null, created: false, existed: false, error: res.reason });
      break;
    }

    outcomes.push({ kind: entry.kind, name: entry.name, status: null, created: false, existed: false, error: res.reason });
  }

  const templates = Object.keys(patch).length > 0 ? await mergeWaTemplates(clinicId, patch) : current;
  return { ok: !fatal, reason: fatal, outcomes, templates };
}

function selectEntries(opts: ProvisionOptions): WaCatalogEntry[] {
  if (opts.kinds && opts.kinds.length > 0) {
    return opts.kinds
      .map((k) => catalogEntryFor(k))
      .filter((e): e is WaCatalogEntry => e !== null);
  }
  return WA_TEMPLATE_CATALOG.filter((e) => !e.optional || opts.includeMarketing === true);
}

type CreateResult =
  | { kind: "ok"; status: WaTemplateStatus; metaId?: string; existed: boolean }
  /** Falla propia de esta plantilla: las demás pueden seguir. */
  | { kind: "error"; reason: string }
  /** Falla de la cuenta (permiso, token): no tiene sentido seguir. */
  | { kind: "fatal"; reason: string };

async function createTemplate(
  wabaId: string,
  token: string,
  entry: WaCatalogEntry,
): Promise<CreateResult> {
  let json: any;
  let httpStatus = 0;
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/message_templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildTemplateCreatePayload(entry)),
      signal: AbortSignal.timeout(15000),
    });
    httpStatus = res.status;
    json = await res.json().catch(() => ({}));
    if (res.ok && json?.id) {
      // Meta responde { id, status, category }. Recién creada suele venir
      // PENDING; en cuentas con historial puede llegar APPROVED de una vez.
      return { kind: "ok", status: mapMetaTemplateStatus(json.status ?? "PENDING"), metaId: String(json.id), existed: false };
    }
  } catch (e) {
    // Timeout o red. No es fatal: puede haberse creado igual, y el cron de
    // respaldo lo verá en la siguiente pasada.
    return { kind: "error", reason: `No se pudo contactar a Meta (${errText(e)}).` };
  }

  const err = json?.error ?? {};
  if (isAlreadyExists(err)) {
    // NO es un error: el nombre ya está ocupado en esa WABA (la creamos antes,
    // o la clínica la dio de alta a mano). Se recupera y se registra su estado.
    const found = await fetchTemplateByName(wabaId, token, entry);
    if (found) return { ...found, existed: true };
    return {
      kind: "error",
      reason: "Meta dice que la plantilla ya existe pero no la devuelve. Reintenta en unos minutos.",
    };
  }
  if (isFatalAccountError(err, httpStatus)) {
    return { kind: "fatal", reason: fatalReason(err, httpStatus) };
  }
  return { kind: "error", reason: metaMessage(err) };
}

/** Busca una plantilla por nombre exacto e idioma dentro de la WABA. */
async function fetchTemplateByName(
  wabaId: string,
  token: string,
  entry: WaCatalogEntry,
): Promise<{ kind: "ok"; status: WaTemplateStatus; metaId?: string } | null> {
  try {
    const url =
      `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates` +
      `?name=${encodeURIComponent(entry.name)}` +
      `&fields=name,status,language,rejected_reason,id&limit=50`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json?.data)) return null;
    // El filtro `name` de Meta es una búsqueda, no una igualdad: hay que
    // quedarse con la coincidencia exacta de nombre E idioma.
    const row =
      json.data.find((t: any) => t?.name === entry.name && t?.language === entry.lang) ??
      json.data.find((t: any) => t?.name === entry.name);
    if (!row) return null;
    return { kind: "ok", status: mapMetaTemplateStatus(row.status), metaId: row.id ? String(row.id) : undefined };
  } catch {
    return null;
  }
}

/* ─────────────────── reconciliación (webhook y cron) ─────────────────── */

/**
 * Escribe el estado que Meta reporta para UNA plantilla, buscándola por su
 * nombre dentro del catálogo. Lo usan el webhook y el cron.
 *
 * Ignora en silencio los nombres que no son nuestros: la clínica puede tener
 * sus propias plantillas en la misma cuenta y su estado no nos incumbe.
 */
export async function applyTemplateStatus(args: {
  clinicId: string;
  templateName: string;
  status: WaTemplateStatus;
  reason?: string | null;
  metaId?: string | null;
  lang?: string | null;
}): Promise<boolean> {
  const entry = catalogEntryByName(args.templateName);
  if (!entry) return false;

  const cfg: WaTemplateConfig = {
    name: entry.name,
    lang: args.lang && args.lang.trim() !== "" ? args.lang.trim() : entry.lang,
    status: args.status,
    updatedAt: new Date().toISOString(),
  };
  const reason = (args.reason ?? "").trim();
  if (reason) cfg.reason = reason.slice(0, 500);
  if (args.metaId) cfg.metaId = String(args.metaId);

  await mergeWaTemplates(args.clinicId, { [entry.kind]: cfg });
  return true;
}

/**
 * Procesa el aviso `message_template_status_update` del webhook de Meta.
 *
 * `entry[].id` de ESE aviso es el WABA id (no el phone_number_id, que ni
 * siquiera viaja), así que la clínica se resuelve por `waBusinessAccountId`.
 * Best-effort: nunca lanza.
 */
export async function ingestTemplateStatusUpdate(
  wabaId: string | null | undefined,
  value: any,
): Promise<void> {
  try {
    const waba = (wabaId ?? "").trim();
    const name = value?.message_template_name;
    if (!waba || typeof name !== "string") return;

    const clinic = await prisma.clinic.findFirst({
      where: { waBusinessAccountId: waba },
      select: { id: true },
    });
    if (!clinic) return;

    // `event` es el estado nuevo (APPROVED, REJECTED, PAUSED…). Meta manda el
    // motivo en `reason` y a veces detalles en `other_info`.
    const status = mapMetaTemplateStatus(value?.event ?? null);
    const reason =
      status === "REJECTED"
        ? describeRejectionReason(value?.reason) ||
          (typeof value?.other_info?.description === "string" ? value.other_info.description : "")
        : "";

    const applied = await applyTemplateStatus({
      clinicId: clinic.id,
      templateName: name,
      status,
      reason,
      metaId: value?.message_template_id ? String(value.message_template_id) : null,
      lang: typeof value?.message_template_language === "string" ? value.message_template_language : null,
    });
    if (applied) {
      console.log(
        `[whatsapp/templates] ${name} → ${status} en la clínica ${clinic.id} (webhook)`,
      );
    }
  } catch (e) {
    console.error("[whatsapp/templates] no se pudo procesar el aviso de plantilla:", e);
  }
}

export interface SyncResult {
  ok: boolean;
  reason?: string;
  /** Cuántas filas de `waTemplates` cambiaron de estado. */
  changed: number;
}

/**
 * Respaldo del webhook: pregunta a Meta el estado REAL de las plantillas del
 * catálogo en la WABA de una clínica y actualiza lo que haya cambiado.
 *
 * Existe porque un webhook perdido dejaría la plantilla en "en revisión" para
 * siempre y con ella los recordatorios apagados sin que nadie lo sepa.
 */
export async function syncClinicTemplates(clinicId: string): Promise<SyncResult> {
  const clinic = await prisma.clinic
    .findUnique({
      where: { id: clinicId },
      select: { id: true, waBusinessAccountId: true, waAccessToken: true, waTemplates: true },
    })
    .catch(() => null);
  if (!clinic?.waBusinessAccountId) return { ok: false, reason: "sin_waba", changed: 0 };
  const token = clinic.waAccessToken ? decryptField(clinic.waAccessToken) ?? clinic.waAccessToken : null;
  if (!token) return { ok: false, reason: "sin_token", changed: 0 };

  let rows: any[];
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(clinic.waBusinessAccountId)}/message_templates` +
        `?fields=name,status,language,rejected_reason,id&limit=100`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json?.data)) {
      return { ok: false, reason: metaMessage(json?.error ?? {}), changed: 0 };
    }
    rows = json.data;
  } catch (e) {
    return { ok: false, reason: errText(e), changed: 0 };
  }

  const current = parseWaTemplates(clinic.waTemplates);
  const patch: WaTemplateMap = {};
  for (const row of rows) {
    const entry = typeof row?.name === "string" ? catalogEntryByName(row.name) : null;
    if (!entry) continue;                       // plantilla ajena: no es asunto nuestro
    if (row?.language && row.language !== entry.lang) continue;
    const status = mapMetaTemplateStatus(row.status);
    const prev = current[entry.kind];
    const reason = status === "REJECTED" ? describeRejectionReason(row.rejected_reason) : "";
    if (prev && prev.status === status && (prev.reason ?? "") === reason) continue;  // sin cambios
    patch[entry.kind] = {
      name: entry.name,
      lang: entry.lang,
      status,
      updatedAt: new Date().toISOString(),
      ...(reason ? { reason } : {}),
      ...(row.id ? { metaId: String(row.id) } : prev?.metaId ? { metaId: prev.metaId } : {}),
    };
  }

  const changed = Object.keys(patch).length;
  if (changed > 0) await mergeWaTemplates(clinicId, patch);
  return { ok: true, changed };
}

/** Clínicas con alguna plantilla en revisión desde hace más de `hours` horas. */
export async function clinicsWithStalePendingTemplates(hours: number): Promise<string[]> {
  const clinics = await prisma.clinic.findMany({
    where: { waConnected: true, NOT: { waBusinessAccountId: null } },
    select: { id: true, waTemplates: true },
    take: 500,
  });
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const out: string[] = [];
  for (const c of clinics) {
    const map = parseWaTemplates(c.waTemplates);
    const stale = Object.values(map).some((cfg) => {
      if (!cfg || cfg.status !== "PENDING") return false;
      // Sin fecha se considera vieja: es una fila de antes de esta corrida.
      if (!cfg.updatedAt) return true;
      const t = Date.parse(cfg.updatedAt);
      return Number.isNaN(t) || t < cutoff;
    });
    if (stale) out.push(c.id);
  }
  return out;
}

/* ────────────────────────────── internos ────────────────────────────── */

/**
 * Mezcla `patch` sobre `waTemplates` releyendo la fila justo antes de escribir.
 *
 * La relectura importa: entre el inicio del alta (que tarda segundos) y el
 * guardado, la clínica puede haber tocado la pantalla de plantillas. Escribir
 * el mapa que se leyó al principio borraría ese cambio.
 */
async function mergeWaTemplates(clinicId: string, patch: WaTemplateMap): Promise<WaTemplateMap> {
  const fresh = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { waTemplates: true },
  });
  const merged: WaTemplateMap = { ...parseWaTemplates(fresh?.waTemplates ?? null), ...patch };
  await prisma.clinic.update({
    where: { id: clinicId },
    // El cast es estructural: `merged` solo lleva strings ya validados, pero
    // el Json de entrada de Prisma pide índice de cadena.
    data: { waTemplates: merged as unknown as Prisma.InputJsonObject },
  });
  return merged;
}

/** ¿Meta dice que el nombre ya está ocupado en esa WABA? */
function isAlreadyExists(err: any): boolean {
  const code = Number(err?.code);
  const sub = Number(err?.error_subcode);
  if (code === 2388023 || sub === 2388023) return true;
  const msg = `${err?.message ?? ""} ${err?.error_user_msg ?? ""}`.toLowerCase();
  return msg.includes("already exists") || msg.includes("ya existe");
}

/** ¿El fallo es de la cuenta entera (permiso, token) y no de esta plantilla? */
function isFatalAccountError(err: any, httpStatus: number): boolean {
  const code = Number(err?.code);
  if (code === 190 || code === 200 || code === 10 || code === 3) return true;
  if (httpStatus === 401 || httpStatus === 403) return true;
  const msg = `${err?.message ?? ""}`.toLowerCase();
  return msg.includes("permission") || msg.includes("access token");
}

function fatalReason(err: any, httpStatus: number): string {
  const code = Number(err?.code);
  if (code === 190 || httpStatus === 401) {
    return "La conexión con Meta caducó. Vuelve a conectar WhatsApp y reintenta.";
  }
  return (
    "El acceso que nos dio Meta no permite crear plantillas en la cuenta de la clínica " +
    `(${metaMessage(err)}). Vuelve a conectar WhatsApp aceptando todos los permisos.`
  );
}

/** Mensaje de Meta, ya recortado. Nunca incluye credenciales. */
function metaMessage(err: any): string {
  const msg =
    (typeof err?.error_user_msg === "string" && err.error_user_msg) ||
    (typeof err?.message === "string" && err.message) ||
    "Meta rechazó la petición sin dar detalle.";
  return String(msg).slice(0, 300);
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 200);
  return String(e).slice(0, 200);
}
