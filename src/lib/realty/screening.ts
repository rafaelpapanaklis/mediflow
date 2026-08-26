import "server-only";
/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — INVESTIGACIÓN DE INQUILINO.

   Es ingreso que NO depende de la suscripción: hoy el propietario ya paga
   por esto (rango de mercado en el reporte de ORQUESTA.md, no aquí), lo
   pide por WhatsApp a un tercero y el expediente se queda en el correo de
   alguien. Aquí queda dentro del contrato, con su consentimiento y su
   historial.

   🔴 SIN INTEGRACIÓN CON NINGÚN PROVEEDOR TODAVÍA. No hay convenio con Liv,
   Moradauno, Multiburó ni Inquilino Seguro, y NO se inventa uno: el
   proveedor de hoy es "MANUAL" — se solicita, alguien de DaleControl la
   tramita por fuera y sube el resultado. El adaptador queda listo y su
   interfaz documentada (RealtyScreeningProvider, en growth-shared.ts).

   🔴 EL CONSENTIMIENTO ES OBLIGATORIO Y ES LEGAL, NO UN CHECKBOX.
   Consultar el buró de crédito de alguien sin su autorización expresa es
   ilegal en México. Aquí se guarda el TEXTO que aceptó, con fecha, nombre e
   IP, y la base lo repite con un CHECK: una solicitud no puede salir de
   PENDIENTE_CONSENTIMIENTO sin `consentAt`. Un bug de pantalla no puede
   saltárselo.
   ═══════════════════════════════════════════════════════════════════════ */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import type { RealtyContext } from "@/lib/realty-auth";
import { isMissingRealtyGrowthTable } from "@/lib/realty/bot/core";
import { newGrowthId, realtyGrowthStorageReady } from "@/lib/realty/bot/growth-db";
import {
  buildRealtyScreeningConsentText,
  emptyRealtyScreeningApplicant,
  type RealtyScreeningApplicant,
  type RealtyScreeningDTO,
  type RealtyScreeningFetchResult,
  type RealtyScreeningProvider,
  type RealtyScreeningRecommendation,
  type RealtyScreeningRequestStatus,
  type RealtyScreeningRiskLevel,
  type RealtyScreeningSubmitInput,
  type RealtyScreeningSubmitResult,
  type RealtyScreeningTier,
} from "@/components/realty/growth/growth-shared";

export class RealtyScreeningError extends Error {
  readonly code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE" | "CONSENT";
  constructor(code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE" | "CONSENT", message: string) {
    super(message);
    this.name = "RealtyScreeningError";
    this.code = code;
  }
}

/**
 * Status HTTP de cada codigo de error. Vive aqui y no en una ruta porque un
 * archivo `route.ts` de Next solo puede exportar los verbos y su config:
 * cualquier otro export tumba la comprobacion de tipos del router.
 *
 * CONSENT es 422 y no 403: no es "no puedes", es "falta la autorizacion del
 * investigado" — y esa diferencia es la que la pantalla tiene que explicar.
 */
export function screeningErrorStatus(code: RealtyScreeningError["code"]): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "STORAGE":
      return 503;
    case "STATE":
      return 409;
    case "CONSENT":
      return 422;
    default:
      return 400;
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ═══════════════════════════════════════════════════════════════════════
   1. EL ADAPTADOR — cómo se enchufa un proveedor cuando haya convenio
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El proveedor de HOY. No habla con nadie: deja la solicitud lista para que
 * una persona la tramite. Es deliberadamente aburrido — su valor está en
 * que el resto del sistema ya funciona igual que funcionará con una API.
 */
export const MANUAL_SCREENING_PROVIDER: RealtyScreeningProvider = {
  id: "MANUAL",
  label: "DaleControl (se tramita a mano)",
  automated: false,
  tiers: ["BASICA", "COMPLETA"],

  async submit(input: RealtyScreeningSubmitInput): Promise<RealtyScreeningSubmitResult> {
    // La garantía que el contrato del adaptador promete: `submit` jamás se
    // llama sin consentimiento. Se comprueba igual — un adaptador que
    // confía a ciegas es el que un día manda un buró sin permiso.
    if (!input.consent?.at) {
      return {
        ok: false,
        providerRef: null,
        status: "PENDIENTE_CONSENTIMIENTO",
        priceCents: null,
        error: "Falta la autorización del investigado.",
      };
    }
    // El folio manual es el propio id de la solicitud: es lo que la persona
    // que la tramita va a buscar en el panel.
    return {
      ok: true,
      providerRef: input.requestId,
      status: "SOLICITADA",
      priceCents: null,
      error: null,
    };
  },

  async fetch(): Promise<RealtyScreeningFetchResult> {
    // No hay a quién preguntarle: el resultado lo sube una persona.
    return {
      ok: true,
      status: "SOLICITADA",
      resultUrl: null,
      resultSummary: null,
      riskLevel: null,
      recommendation: null,
      error: null,
    };
  },
};

/**
 * ⭐ EL REGISTRO. Enchufar un proveedor con API es agregar UNA entrada aquí
 * y nada más: la columna `provider` ya es texto, `providerRef` ya guarda su
 * folio, y el barrido ya llama a `fetch` de quien corresponda.
 *
 * Ejemplo de lo que habría que escribir el día del convenio:
 *
 *   const LIV_PROVIDER: RealtyScreeningProvider = {
 *     id: "LIV", label: "Liv", automated: true, tiers: ["BASICA","COMPLETA"],
 *     async submit(input) { … POST a su API … return { ok, providerRef, status:"EN_PROCESO", priceCents, error:null } },
 *     async fetch(ref)    { … GET  a su API … return { ok, status, resultUrl, resultSummary, riskLevel, recommendation, error:null } },
 *   };
 *   REALTY_SCREENING_PROVIDERS.LIV = LIV_PROVIDER;
 */
export const REALTY_SCREENING_PROVIDERS: Record<string, RealtyScreeningProvider> = {
  MANUAL: MANUAL_SCREENING_PROVIDER,
};

export function resolveScreeningProvider(id: string | null | undefined): RealtyScreeningProvider {
  const key = String(id ?? "MANUAL").toUpperCase();
  return REALTY_SCREENING_PROVIDERS[key] ?? MANUAL_SCREENING_PROVIDER;
}

/** Cuál se usa por default. Se cambia por env el día del convenio. */
export function defaultScreeningProviderId(): string {
  const env = (process.env.REALTY_SCREENING_PROVIDER || "").trim().toUpperCase();
  return env && REALTY_SCREENING_PROVIDERS[env] ? env : "MANUAL";
}

/* ═══════════════════════════════════════════════════════════════════════
   2. NORMALIZACIÓN del investigado
   ═══════════════════════════════════════════════════════════════════════ */

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

export function normalizeApplicant(raw: unknown): RealtyScreeningApplicant {
  const base = emptyRealtyScreeningApplicant();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = raw as Record<string, unknown>;
  const income = Number(src.declaredIncomeMxn);
  const refs = Array.isArray(src.references) ? src.references : [];
  return {
    fullName: cleanStr(src.fullName, 120) ?? "",
    phone: mxTenDigits(String(src.phone ?? "")) ?? null,
    email: cleanStr(src.email, 160),
    // CURP y RFC en MAYÚSCULAS y sin espacios: así los pide el buró y así
    // se comparan sin sorpresas.
    curp: cleanStr(src.curp, 18)?.toUpperCase().replace(/\s/g, "") ?? null,
    rfc: cleanStr(src.rfc, 13)?.toUpperCase().replace(/\s/g, "") ?? null,
    birthDate: cleanStr(src.birthDate, 10),
    declaredIncomeMxn: Number.isFinite(income) && income > 0 ? Math.round(income) : null,
    employer: cleanStr(src.employer, 120),
    jobTitle: cleanStr(src.jobTitle, 120),
    references: refs
      .slice(0, 5)
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          name: cleanStr(o.name, 120) ?? "",
          phone: mxTenDigits(String(o.phone ?? "")) ?? "",
          relation: cleanStr(o.relation, 60),
        };
      })
      .filter((r) => r.name && r.phone),
    notes: cleanStr(src.notes, 1000),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   3. EL FLUJO
   ═══════════════════════════════════════════════════════════════════════ */

export interface CreateScreeningInput {
  contactId: string;
  tier: RealtyScreeningTier;
  leaseId?: string | null;
  propertyId?: string | null;
  leasePartyId?: string | null;
  applicant: RealtyScreeningApplicant;
  priceCents?: number | null;
}

/**
 * Paso 1: se captura. Nace en PENDIENTE_CONSENTIMIENTO SIEMPRE — no hay
 * parámetro para saltárselo. Quien la crea es alguien del equipo; quien la
 * autoriza es el investigado, y eso es un acto aparte.
 */
export async function createScreeningRequest(
  ctx: RealtyContext,
  input: CreateScreeningInput,
): Promise<string> {
  if (!(await realtyGrowthStorageReady())) {
    throw new RealtyScreeningError("STORAGE", "Falta aplicar sql/realty_growth.sql en la base.");
  }
  const contact = await prisma.realtyContact.findFirst({
    where: { id: input.contactId, accountId: ctx.accountId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!contact) throw new RealtyScreeningError("NOT_FOUND", "Ese contacto no es de tu cuenta.");

  const tier: RealtyScreeningTier = input.tier === "COMPLETA" ? "COMPLETA" : "BASICA";
  const applicant = normalizeApplicant({
    ...input.applicant,
    fullName: input.applicant?.fullName || contact.name,
    phone: input.applicant?.phone || contact.phone,
    email: input.applicant?.email || contact.email,
  });
  if (!applicant.fullName) {
    throw new RealtyScreeningError("INVALID", "Falta el nombre completo del investigado.");
  }
  if (!applicant.curp && !applicant.rfc) {
    throw new RealtyScreeningError(
      "INVALID",
      "Se necesita CURP o RFC: sin uno de los dos no se puede consultar el buró.",
    );
  }

  // El contrato y el inmueble se validan CONTRA LA CUENTA. Sin esto, un id
  // ajeno en el body colgaría el expediente de una renta de otra cuenta.
  let leaseId: string | null = null;
  let propertyId: string | null = input.propertyId ?? null;
  if (input.leaseId) {
    const lease = await prisma.realtyLease.findFirst({
      where: { id: input.leaseId, accountId: ctx.accountId },
      select: { id: true, propertyId: true },
    });
    if (!lease) throw new RealtyScreeningError("NOT_FOUND", "Ese contrato no es de tu cuenta.");
    leaseId = lease.id;
    propertyId = propertyId ?? lease.propertyId;
  }
  if (propertyId) {
    const p = await prisma.realtyProperty.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!p) propertyId = null;
  }

  const id = newGrowthId();
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO realty_screening_requests
                 (id,"accountId","contactId","leaseId","leasePartyId","propertyId",tier,provider,
                  status,applicant,"priceCents","requestedById","createdAt","updatedAt")
               VALUES (${id}, ${ctx.accountId}, ${contact.id}, ${leaseId},
                       ${input.leasePartyId ?? null}, ${propertyId}, ${tier},
                       ${defaultScreeningProviderId()}, 'PENDIENTE_CONSENTIMIENTO',
                       ${JSON.stringify(applicant)}::jsonb,
                       ${input.priceCents ?? null}, ${ctx.realtyUserId},
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  return id;
}

/**
 * Paso 2: EL INVESTIGADO AUTORIZA. Se guarda el texto completo que aceptó,
 * su nombre tal cual lo escribió, la fecha y la IP.
 *
 * `consentName` tiene que PARECERSE al nombre del investigado: aceptar una
 * autorización firmada "aaa" es no tener autorización. No se exige
 * identidad exacta (la gente escribe "Juan Pérez G." donde el expediente
 * dice "Juan Pérez García"), pero sí el primer apellido o el nombre.
 */
export async function recordScreeningConsent(args: {
  accountId: string;
  requestId: string;
  consentName: string;
  accountName: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  const req = await getScreeningRequestRow(args.accountId, args.requestId);
  if (!req) throw new RealtyScreeningError("NOT_FOUND", "Esa solicitud no existe.");
  if (req.status !== "PENDIENTE_CONSENTIMIENTO") {
    throw new RealtyScreeningError("STATE", "Esa solicitud ya fue autorizada.");
  }

  const typed = String(args.consentName ?? "").replace(/\s+/g, " ").trim();
  if (typed.length < 5) {
    throw new RealtyScreeningError("CONSENT", "Escribe tu nombre completo para autorizar.");
  }
  const applicant = normalizeApplicant(req.applicant);
  if (!namesLookAlike(typed, applicant.fullName)) {
    throw new RealtyScreeningError(
      "CONSENT",
      "El nombre que escribiste no coincide con el del expediente.",
    );
  }

  const text = buildRealtyScreeningConsentText(
    (req.tier as RealtyScreeningTier) ?? "BASICA",
    args.accountName,
  );

  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_screening_requests
               SET "consentText" = ${text}, "consentAt" = CURRENT_TIMESTAMP,
                   "consentName" = ${typed}, "consentIp" = ${args.ip},
                   "consentUserAgent" = ${(args.userAgent ?? "").slice(0, 400) || null},
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${args.requestId} AND "accountId" = ${args.accountId}
                 AND status = 'PENDIENTE_CONSENTIMIENTO'`,
  );
  return toNumber(n) > 0;
}

/** ¿Estos dos nombres son de la misma persona? Tolerante pero no ciego. */
export function namesLookAlike(typed: string, expected: string): boolean {
  const fold = (s: string) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = fold(typed);
  const b = fold(expected);
  if (a.length === 0 || b.length === 0) return false;
  return a.some((w) => b.includes(w));
}

/**
 * Paso 3: se manda al proveedor. Con MANUAL solo cambia de estado y queda
 * en la bandeja de quien la tramita.
 */
export async function submitScreeningRequest(args: {
  accountId: string;
  accountName: string;
  accountEmail: string | null;
  requestId: string;
}): Promise<{ ok: boolean; status: RealtyScreeningRequestStatus; error: string | null }> {
  const req = await getScreeningRequestRow(args.accountId, args.requestId);
  if (!req) throw new RealtyScreeningError("NOT_FOUND", "Esa solicitud no existe.");
  // 🔴 LA PUERTA. La base también la tiene (CHECK realty_screening_needs_consent),
  // pero fallar aquí da un mensaje en español en vez de un error de Postgres.
  if (!req.consentAt) {
    throw new RealtyScreeningError(
      "CONSENT",
      "Todavía no autoriza el investigado. Sin su permiso no se puede consultar su buró.",
    );
  }
  if (req.status !== "PENDIENTE_CONSENTIMIENTO" && req.status !== "SOLICITADA") {
    throw new RealtyScreeningError("STATE", "Esa solicitud ya está en proceso.");
  }

  let monthlyRentMxn: number | null = null;
  if (req.leaseId) {
    const lease = await prisma.realtyLease.findFirst({
      where: { id: req.leaseId, accountId: args.accountId },
      select: { rentAmount: true },
    });
    monthlyRentMxn = lease ? Number(lease.rentAmount ?? 0) || null : null;
  }

  const provider = resolveScreeningProvider(req.provider);
  const result = await provider.submit({
    requestId: req.id,
    tier: (req.tier as RealtyScreeningTier) ?? "BASICA",
    applicant: normalizeApplicant(req.applicant),
    consent: {
      text: req.consentText ?? "",
      at: toIso(req.consentAt) ?? new Date().toISOString(),
      name: req.consentName ?? "",
      ip: req.consentIp ?? null,
    },
    account: { id: args.accountId, name: args.accountName, email: args.accountEmail },
    monthlyRentMxn,
  });

  if (!result.ok) {
    return { ok: false, status: req.status as RealtyScreeningRequestStatus, error: result.error };
  }

  await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_screening_requests
               SET status = ${result.status}, "providerRef" = ${result.providerRef},
                   "priceCents" = COALESCE(${result.priceCents}, "priceCents"),
                   "requestedAt" = COALESCE("requestedAt", CURRENT_TIMESTAMP),
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${req.id} AND "accountId" = ${args.accountId}`,
  );
  return { ok: true, status: result.status, error: null };
}

/**
 * Paso 4: el resultado. Con MANUAL lo sube una persona; con un proveedor
 * con API lo escribe el barrido llamando a `provider.fetch`.
 *
 * Al quedar LISTA se refleja en `RealtyLeaseParty.screeningStatus`, que es
 * la columna que el contrato de renta ya tenía reservada para esto.
 */
export async function deliverScreeningResult(args: {
  accountId: string;
  requestId: string;
  resultUrl: string | null;
  resultSummary: string | null;
  riskLevel: RealtyScreeningRiskLevel | null;
  recommendation: RealtyScreeningRecommendation | null;
}): Promise<boolean> {
  const req = await getScreeningRequestRow(args.accountId, args.requestId);
  if (!req) throw new RealtyScreeningError("NOT_FOUND", "Esa solicitud no existe.");
  if (!req.consentAt) {
    throw new RealtyScreeningError("CONSENT", "Esa solicitud no tiene autorización.");
  }

  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_screening_requests
               SET status = 'LISTA', "resultUrl" = ${args.resultUrl},
                   "resultSummary" = ${args.resultSummary}, "riskLevel" = ${args.riskLevel},
                   recommendation = ${args.recommendation},
                   "deliveredAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${req.id} AND "accountId" = ${args.accountId}`,
  );
  if (toNumber(n) === 0) return false;

  // Reflejo en el contrato: APROBADO/APROBADO_CON_AVAL → APROBADO;
  // RECHAZADO → RECHAZADO; sin dictamen se queda PENDIENTE.
  const mapped =
    args.recommendation === "RECHAZADO"
      ? "RECHAZADO"
      : args.recommendation === "APROBADO" || args.recommendation === "APROBADO_CON_AVAL"
        ? "APROBADO"
        : "PENDIENTE";
  if (req.leaseId) {
    await prisma.realtyLeaseParty.updateMany({
      where: {
        accountId: args.accountId,
        leaseId: req.leaseId,
        contactId: req.contactId,
      },
      data: { screeningStatus: mapped as never },
    });
  }
  return true;
}

export async function cancelScreeningRequest(
  accountId: string,
  requestId: string,
): Promise<boolean> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_screening_requests
               SET status = 'CANCELADA', "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = ${requestId} AND "accountId" = ${accountId}
                 AND status <> 'LISTA'`,
  );
  return toNumber(n) > 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   4. LECTURAS
   ═══════════════════════════════════════════════════════════════════════ */

interface ScreeningRow {
  id: string;
  contactId: string;
  contactName: string | null;
  leaseId: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  tier: string;
  provider: string;
  providerRef: string | null;
  status: string;
  consentText: string | null;
  consentAt: Date | null;
  consentName: string | null;
  consentIp: string | null;
  applicant: unknown;
  priceCents: number | null;
  resultUrl: string | null;
  resultSummary: string | null;
  riskLevel: string | null;
  recommendation: string | null;
  requestedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

async function getScreeningRequestRow(
  accountId: string,
  requestId: string,
): Promise<ScreeningRow | null> {
  try {
    const rows = await prisma.$queryRaw<ScreeningRow[]>(
      Prisma.sql`SELECT s.id, s."contactId", c.name AS "contactName", s."leaseId", s."propertyId",
                        p.title AS "propertyTitle", s.tier, s.provider, s."providerRef", s.status,
                        s."consentText", s."consentAt", s."consentName", s."consentIp",
                        s.applicant, s."priceCents", s."resultUrl", s."resultSummary",
                        s."riskLevel", s.recommendation, s."requestedAt", s."deliveredAt",
                        s."createdAt"
                 FROM realty_screening_requests s
                 LEFT JOIN realty_contacts c ON c.id = s."contactId"
                 LEFT JOIN realty_properties p ON p.id = s."propertyId"
                 WHERE s.id = ${requestId} AND s."accountId" = ${accountId}
                 LIMIT 1`,
    );
    return rows?.[0] ?? null;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/screening] no se pudo leer la solicitud:", err);
    }
    return null;
  }
}

function toDTO(r: ScreeningRow): RealtyScreeningDTO {
  return {
    id: r.id,
    contactId: r.contactId,
    contactName: r.contactName ?? "",
    leaseId: r.leaseId,
    propertyId: r.propertyId,
    propertyTitle: r.propertyTitle,
    tier: (r.tier === "COMPLETA" ? "COMPLETA" : "BASICA") as RealtyScreeningTier,
    provider: r.provider,
    providerRef: r.providerRef,
    status: r.status as RealtyScreeningRequestStatus,
    consentAt: toIso(r.consentAt),
    consentName: r.consentName,
    applicant: normalizeApplicant(r.applicant),
    priceCents: r.priceCents,
    priceMxn: r.priceCents === null || r.priceCents === undefined ? null : r.priceCents / 100,
    resultUrl: r.resultUrl,
    resultSummary: r.resultSummary,
    riskLevel: r.riskLevel as RealtyScreeningRiskLevel | null,
    recommendation: r.recommendation as RealtyScreeningRecommendation | null,
    requestedAt: toIso(r.requestedAt),
    deliveredAt: toIso(r.deliveredAt),
    createdAt: toIso(r.createdAt) ?? new Date().toISOString(),
  } as RealtyScreeningDTO;
}

export async function getScreeningRequest(
  accountId: string,
  requestId: string,
): Promise<RealtyScreeningDTO | null> {
  const row = await getScreeningRequestRow(accountId, requestId);
  return row ? toDTO(row) : null;
}

/**
 * La solicitud vista por el INVESTIGADO, para la pantalla donde autoriza.
 * 🔴 Devuelve lo MÍNIMO: quién investiga, qué se va a consultar y el texto
 * que va a aceptar. Nunca el resultado, nunca el CURP, nunca las
 * referencias — quien abre esa liga puede no ser el investigado.
 */
export async function getScreeningConsentView(
  accountId: string,
  requestId: string,
  accountName: string,
): Promise<{
  id: string;
  tier: RealtyScreeningTier;
  status: RealtyScreeningRequestStatus;
  applicantFirstName: string;
  consentText: string;
  alreadyConsented: boolean;
} | null> {
  const row = await getScreeningRequestRow(accountId, requestId);
  if (!row) return null;
  const tier = (row.tier === "COMPLETA" ? "COMPLETA" : "BASICA") as RealtyScreeningTier;
  const applicant = normalizeApplicant(row.applicant);
  return {
    id: row.id,
    tier,
    status: row.status as RealtyScreeningRequestStatus,
    applicantFirstName: applicant.fullName.split(/\s+/)[0] ?? "",
    consentText: row.consentText ?? buildRealtyScreeningConsentText(tier, accountName),
    alreadyConsented: Boolean(row.consentAt),
  };
}

export async function listScreeningRequests(
  accountId: string,
  opts: { contactId?: string | null; leaseId?: string | null; limit?: number } = {},
): Promise<RealtyScreeningDTO[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 60)));
  try {
    const rows = await prisma.$queryRaw<ScreeningRow[]>(
      Prisma.sql`SELECT s.id, s."contactId", c.name AS "contactName", s."leaseId", s."propertyId",
                        p.title AS "propertyTitle", s.tier, s.provider, s."providerRef", s.status,
                        s."consentText", s."consentAt", s."consentName", s."consentIp",
                        s.applicant, s."priceCents", s."resultUrl", s."resultSummary",
                        s."riskLevel", s.recommendation, s."requestedAt", s."deliveredAt",
                        s."createdAt"
                 FROM realty_screening_requests s
                 LEFT JOIN realty_contacts c ON c.id = s."contactId"
                 LEFT JOIN realty_properties p ON p.id = s."propertyId"
                 WHERE s."accountId" = ${accountId}
                   ${opts.contactId ? Prisma.sql`AND s."contactId" = ${opts.contactId}` : Prisma.empty}
                   ${opts.leaseId ? Prisma.sql`AND s."leaseId" = ${opts.leaseId}` : Prisma.empty}
                 ORDER BY s."createdAt" DESC
                 LIMIT ${limit}`,
    );
    return rows.map(toDTO);
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/screening] no se pudieron listar:", err);
    }
    return [];
  }
}

/**
 * Barrido: pregunta al proveedor por las que siguen en proceso. Con MANUAL
 * no hace nada (no hay a quién preguntarle) y por eso no se llama sobre
 * proveedores no automatizados: gastar una vuelta para nada confunde los
 * registros.
 */
export async function sweepScreeningResults(accountId?: string): Promise<number> {
  if (!(await realtyGrowthStorageReady())) return 0;
  let updated = 0;
  const rows = await prisma.$queryRaw<
    { id: string; accountId: string; provider: string; providerRef: string | null }[]
  >(
    Prisma.sql`SELECT id, "accountId", provider, "providerRef"
               FROM realty_screening_requests
               WHERE status IN ('SOLICITADA','EN_PROCESO')
                 ${accountId ? Prisma.sql`AND "accountId" = ${accountId}` : Prisma.empty}
               ORDER BY "requestedAt" NULLS LAST
               LIMIT 100`,
  );
  for (const row of rows) {
    const provider = resolveScreeningProvider(row.provider);
    if (!provider.automated || !row.providerRef) continue;
    const res = await provider.fetch(row.providerRef);
    if (!res.ok || res.status === "SOLICITADA") continue;
    if (res.status === "LISTA") {
      await deliverScreeningResult({
        accountId: row.accountId,
        requestId: row.id,
        resultUrl: res.resultUrl,
        resultSummary: res.resultSummary,
        riskLevel: res.riskLevel,
        recommendation: res.recommendation,
      });
    } else {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE realty_screening_requests
                   SET status = ${res.status}, "updatedAt" = CURRENT_TIMESTAMP
                   WHERE id = ${row.id} AND "accountId" = ${row.accountId}`,
      );
    }
    updated += 1;
  }
  return updated;
}
