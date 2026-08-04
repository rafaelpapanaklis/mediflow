import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
// Config del MOTOR DE COMISIONES de afiliados (montos fijos por plan +
// modalidad recurrente/pago único). Espejo de /api/admin/affiliates/config,
// que gobierna la otra mitad del programa (los % por nivel).
// GET → { config, milestones, exists, plans } (exists=false ⇒ tabla sin crear:
//   el front muestra "corre sql/afiliados-comisiones.sql" y el motor está
//   inactivo).
// PUT { 11 campos del motor + 7 de los bonos por hitos } → upsert fila id=1.
// Auth: sesión admin (mismo patrón que /api/admin/affiliates/config).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { revalidateAffiliateLanding } from "@/lib/cache/public-pricing";
import { getResolvedPlans } from "@/lib/plans";
import {
  DEFAULT_MILESTONES,
  DEFAULT_PAYOUT_CONFIG,
  normalizeMilestones,
  toPayoutConfig,
  type MilestonesConfig,
  type PayoutConfig,
} from "@/lib/affiliates/payout";

export interface AdminPayoutConfigResponse {
  config: PayoutConfig;
  /**
   * Bonos por hitos. Viven en la misma fila pero FUERA de `config`: el motor de
   * comisiones no los conoce y nada los calcula todavía (se anuncian y se
   * configuran, el seguimiento es manual).
   */
  milestones: MilestonesConfig;
  /** false = sql/afiliados-comisiones.sql sin correr → motor inactivo. */
  exists: boolean;
  /** Precios REALES de plan_configs (getResolvedPlans), para las equivalencias. */
  plans: { id: "BASIC" | "PRO" | "CLINIC"; label: string; priceMxn: number }[];
}

/**
 * Precios vigentes de los planes. FUENTE ÚNICA: getResolvedPlans() (plan_configs
 * con su propio fallback). Jamás se escribe un precio a mano aquí: si esto
 * fallara, el front se queda sin equivalencias en vez de mostrar cifras falsas.
 */
async function loadPlans(): Promise<AdminPayoutConfigResponse["plans"]> {
  try {
    const plans = await getResolvedPlans();
    return plans.map((p) => ({ id: p.id, label: p.label, priceMxn: p.priceMxn }));
  } catch {
    return [];
  }
}

/** Etiquetas de los 6 montos, para armar mensajes de error entendibles. */
const AMOUNT_FIELDS = [
  { key: "recurringBasicMxn", label: "Fijo recurrente Básico" },
  { key: "recurringProMxn", label: "Fijo recurrente Profesional" },
  { key: "recurringClinicMxn", label: "Fijo recurrente Clínica" },
  { key: "oneTimeBasicMxn", label: "Pago único Básico" },
  { key: "oneTimeProMxn", label: "Pago único Profesional" },
  { key: "oneTimeClinicMxn", label: "Pago único Clínica" },
] as const;

const MAX_AMOUNT_MXN = 100000;

/** Los 3 escalones de los bonos por hitos, en orden. */
const MILESTONE_FIELDS = [
  { n: 1, clinics: "milestone1Clinics", mxn: "milestone1Mxn" },
  { n: 2, clinics: "milestone2Clinics", mxn: "milestone2Mxn" },
  { n: 3, clinics: "milestone3Clinics", mxn: "milestone3Mxn" },
] as const;

/** El bono más grande de la promoción actual son $100,000: el techo va holgado. */
const MAX_MILESTONE_MXN = 1000000;
const MAX_MILESTONE_CLINICS = 100000;

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await loadPlans();

  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    // Tabla viva: con fila → config real; sin fila → defaults (exists true).
    const body: AdminPayoutConfigResponse = {
      config: row ? toPayoutConfig(row) : { ...DEFAULT_PAYOUT_CONFIG },
      milestones: row ? normalizeMilestones(row) : { ...DEFAULT_MILESTONES },
      exists: true,
      plans,
    };
    return NextResponse.json(body);
  } catch {
    // Tabla inexistente (sql/afiliados-comisiones.sql sin correr) → motor
    // inactivo: el resto del programa sigue con el % por nivel. Nunca 500.
    // Las columnas de hitos sin crear (sql/afiliados-hitos.sql) caen aquí
    // igual: Prisma las pide en el SELECT.
    const body: AdminPayoutConfigResponse = {
      config: { ...DEFAULT_PAYOUT_CONFIG },
      milestones: { ...DEFAULT_MILESTONES },
      exists: false,
      plans,
    };
    return NextResponse.json(body);
  }
}

export async function PUT(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const defaultMode = body?.defaultMode;
  if (defaultMode !== "fixed" && defaultMode !== "pct") {
    return NextResponse.json(
      { error: 'El modo del programa debe ser "fixed" (montos por plan) o "pct" (% por nivel)' },
      { status: 400 }
    );
  }

  const defaultPayoutMode = body?.defaultPayoutMode;
  if (defaultPayoutMode !== "recurring" && defaultPayoutMode !== "onetime") {
    return NextResponse.json(
      { error: 'La modalidad por defecto debe ser "recurring" (fijo mensual) o "onetime" (pago único)' },
      { status: 400 }
    );
  }

  const allowAffiliateChoice = body?.allowAffiliateChoice;
  if (typeof allowAffiliateChoice !== "boolean") {
    return NextResponse.json(
      { error: "El permiso para que el afiliado elija su modalidad debe ser verdadero o falso" },
      { status: 400 }
    );
  }

  // Los 6 montos: número finito entre 0 (plan apagado) y 100,000 MXN.
  const amounts: Record<string, number> = {};
  for (const field of AMOUNT_FIELDS) {
    const value = Number(body?.[field.key]);
    if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT_MXN) {
      return NextResponse.json(
        { error: `${field.label}: debe ser un monto entre 0 y ${MAX_AMOUNT_MXN} MXN` },
        { status: 400 }
      );
    }
    amounts[field.key] = value;
  }

  const startAtInvoiceNo = Number(body?.startAtInvoiceNo);
  if (!Number.isInteger(startAtInvoiceNo) || startAtInvoiceNo < 1 || startAtInvoiceNo > 12) {
    return NextResponse.json(
      { error: "El cobro en el que arranca la comisión debe ser un entero entre 1 y 12" },
      { status: 400 }
    );
  }

  const oneTimeAtInvoiceNo = Number(body?.oneTimeAtInvoiceNo);
  if (!Number.isInteger(oneTimeAtInvoiceNo) || oneTimeAtInvoiceNo < 1 || oneTimeAtInvoiceNo > 12) {
    return NextResponse.json(
      { error: "El cobro en el que se dispara el pago único debe ser un entero entre 1 y 12" },
      { status: 400 }
    );
  }

  // Cruce de las dos reglas: si el pago único se dispara ANTES de que arranque
  // la comisión, el arranque lo corre en silencio (el motor lo entrega en el
  // primer cobro que sí comisiona) y la pantalla prometería un cobro que no es
  // el real. Se rechaza para que el número guardado sea el que manda.
  if (oneTimeAtInvoiceNo < startAtInvoiceNo) {
    return NextResponse.json(
      {
        error:
          "El pago único no se entregaría en ese cobro: debe ser igual o posterior al cobro en el que arranca la comisión",
      },
      { status: 400 }
    );
  }

  // ── Bonos por hitos ────────────────────────────────────────────────────
  // Se ANUNCIAN en /afiliados y /terminos-afiliados; nada los calcula ni los
  // paga. Aun así se validan a fondo: lo que se guarda aquí se publica tal cual
  // y un umbral al revés ("50 clínicas → $2,500, 5 clínicas → $100,000") sería
  // una promesa comercial rota.
  const milestonesEnabled = body?.milestonesEnabled;
  if (typeof milestonesEnabled !== "boolean") {
    return NextResponse.json(
      { error: "El interruptor de los bonos por hitos debe ser verdadero o falso" },
      { status: 400 }
    );
  }

  const milestones: Record<string, number> = {};
  for (const field of MILESTONE_FIELDS) {
    const clinics = Number(body?.[field.clinics]);
    if (!Number.isInteger(clinics) || clinics < 1 || clinics > MAX_MILESTONE_CLINICS) {
      return NextResponse.json(
        { error: `Hito ${field.n}: las clínicas deben ser un entero entre 1 y ${MAX_MILESTONE_CLINICS}` },
        { status: 400 }
      );
    }
    const mxn = Number(body?.[field.mxn]);
    if (!Number.isFinite(mxn) || mxn < 0 || mxn > MAX_MILESTONE_MXN) {
      return NextResponse.json(
        { error: `Hito ${field.n}: el bono debe ser un monto entre 0 y ${MAX_MILESTONE_MXN} MXN` },
        { status: 400 }
      );
    }
    milestones[field.clinics] = clinics;
    milestones[field.mxn] = mxn;
  }

  // Los umbrales tienen que ir en ORDEN ESTRICTO: son escalones acumulables y
  // la página los pinta de menor a mayor. Dos iguales dejarían dos tarjetas
  // prometiendo un bono por el mismo logro.
  if (
    !(milestones.milestone1Clinics < milestones.milestone2Clinics &&
      milestones.milestone2Clinics < milestones.milestone3Clinics)
  ) {
    return NextResponse.json(
      {
        error:
          "Los umbrales de los hitos deben ir en aumento: el hito 1 con menos clínicas que el 2, y el 2 con menos que el 3",
      },
      { status: 400 }
    );
  }

  const data = {
    defaultMode,
    defaultPayoutMode,
    allowAffiliateChoice,
    recurringBasicMxn: amounts.recurringBasicMxn,
    recurringProMxn: amounts.recurringProMxn,
    recurringClinicMxn: amounts.recurringClinicMxn,
    oneTimeBasicMxn: amounts.oneTimeBasicMxn,
    oneTimeProMxn: amounts.oneTimeProMxn,
    oneTimeClinicMxn: amounts.oneTimeClinicMxn,
    startAtInvoiceNo,
    oneTimeAtInvoiceNo,
    milestonesEnabled,
    milestone1Clinics: milestones.milestone1Clinics,
    milestone1Mxn: milestones.milestone1Mxn,
    milestone2Clinics: milestones.milestone2Clinics,
    milestone2Mxn: milestones.milestone2Mxn,
    milestone3Clinics: milestones.milestone3Clinics,
    milestone3Mxn: milestones.milestone3Mxn,
  };

  try {
    const prev = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    const row = await prisma.affiliatePayoutConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "affiliate-payout-config", entityId: "1",
      action: "update",
      // El `before` incluye los hitos: si no, el log diría que aparecieron de
      // la nada en cada guardado.
      before: prev ? { ...toPayoutConfig(prev), ...normalizeMilestones(prev) } : null,
      after: data,
    });
    // La landing /afiliados es ISR: sin esto seguía publicando los montos viejos
    // hasta que venciera su temporizador. Aquí es donde de verdad se arregla.
    // Fire-and-forget en el mismo criterio que los correos del webhook: si la
    // revalidación falla, la config YA está guardada y no puede romperse por
    // eso — se reporta en `revalidated` y el admin lo dice sin mentir.
    const revalidated = revalidateAffiliateLanding();
    return NextResponse.json({
      ok: true,
      config: toPayoutConfig(row),
      milestones: normalizeMilestones(row),
      revalidated,
    });
  } catch {
    // Tabla (o columnas) inexistentes: el admin ve el aviso y sabe qué correr.
    return NextResponse.json(
      { error: "Corre sql/afiliados-comisiones.sql y sql/afiliados-hitos.sql en Supabase" },
      { status: 503 }
    );
  }
}
