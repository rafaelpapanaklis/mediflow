import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
// Config del MOTOR DE COMISIONES de afiliados (montos fijos por plan +
// modalidad recurrente/pago único). Espejo de /api/admin/affiliates/config,
// que gobierna la otra mitad del programa (los % por nivel).
// GET → { config, exists, plans } (exists=false ⇒ tabla sin crear: el front
//   muestra "corre sql/afiliados-comisiones.sql" y el motor está inactivo).
// PUT { 11 campos } → upsert fila id=1.
// Auth: sesión admin (mismo patrón que /api/admin/affiliates/config).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { getResolvedPlans } from "@/lib/plans";
import {
  DEFAULT_PAYOUT_CONFIG,
  toPayoutConfig,
  type PayoutConfig,
} from "@/lib/affiliates/payout";

export interface AdminPayoutConfigResponse {
  config: PayoutConfig;
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

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await loadPlans();

  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    // Tabla viva: con fila → config real; sin fila → defaults (exists true).
    const body: AdminPayoutConfigResponse = {
      config: row ? toPayoutConfig(row) : { ...DEFAULT_PAYOUT_CONFIG },
      exists: true,
      plans,
    };
    return NextResponse.json(body);
  } catch {
    // Tabla inexistente (sql/afiliados-comisiones.sql sin correr) → motor
    // inactivo: el resto del programa sigue con el % por nivel. Nunca 500.
    const body: AdminPayoutConfigResponse = {
      config: { ...DEFAULT_PAYOUT_CONFIG },
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
  // la comisión, no se paga nunca (el arranque corta ese cobro y la igualdad
  // exacta corta los siguientes) y la pantalla se vería perfectamente válida.
  // Es una config rota en silencio, así que se rechaza.
  if (oneTimeAtInvoiceNo < startAtInvoiceNo) {
    return NextResponse.json(
      {
        error:
          "El pago único no se pagaría nunca: su cobro debe ser igual o posterior al cobro en el que arranca la comisión",
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
      action: "update", before: prev ? toPayoutConfig(prev) : null, after: data,
    });
    return NextResponse.json({ ok: true, config: toPayoutConfig(row) });
  } catch {
    // Tabla inexistente: el admin ve el aviso y sabe qué correr.
    return NextResponse.json({ error: "Corre sql/afiliados-comisiones.sql en Supabase" }, { status: 503 });
  }
}
