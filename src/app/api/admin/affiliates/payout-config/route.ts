import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
// Config del MOTOR DE COMISIONES de afiliados (montos fijos por plan +
// modalidad recurrente/pago único). Espejo de /api/admin/affiliates/config,
// que gobierna la otra mitad del programa (los % por nivel).
// GET → { config, milestones, networkBonus, exists, networkBonusExists, plans }
//   (exists=false ⇒ tabla sin crear: el front muestra "corre
//   sql/afiliados-comisiones.sql" y el motor está inactivo;
//   networkBonusExists=false ⇒ falta sql/afiliados-bonos-red.sql).
// PUT { 11 campos del motor + 7 de los bonos por hitos + 11 de los bonos por
//   red } → upsert fila id=1.
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
import {
  DEFAULT_NETWORK_BONUS,
  NETWORK_TIER_KEYS,
  getNetworkBonusConfig,
  normalizeNetworkBonus,
  type NetworkBonusConfig,
} from "@/lib/affiliates/network-bonus";

export interface AdminPayoutConfigResponse {
  config: PayoutConfig;
  /**
   * Bonos por hitos. Viven en la misma fila pero FUERA de `config`: el motor de
   * comisiones no los conoce y nada los calcula todavía (se anuncian y se
   * configuran, el seguimiento es manual).
   */
  milestones: MilestonesConfig;
  /**
   * BONOS POR RED (las 11 columnas VIVAS de sql/afiliados-bonos-red.sql: el
   * interruptor y los 5 pares umbral/pago único). También viven en la fila id=1
   * y también van FUERA de `config`: el motor de comisiones no los conoce — los
   * otorga y los paga el cron mensual.
   *
   * Las cinco `networkTier<N>MonthlyMxn` NO salen ni entran por aquí: la
   * modalidad mensual se retiró (ago 2026) y sus columnas quedaron en 0 y sin
   * uso. Ninguna escritura de este endpoint las menciona.
   */
  networkBonus: NetworkBonusConfig;
  /** false = sql/afiliados-comisiones.sql sin correr → motor inactivo. */
  exists: boolean;
  /**
   * false = las columnas de los bonos por red NO existen todavía → la UI
   * avisa "corre sql/afiliados-bonos-red.sql" y lo que se muestra son los
   * defaults del DDL, no lo guardado.
   */
  networkBonusExists: boolean;
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

/**
 * Techo de un bono POR RED. Es 5× el de los hitos a propósito: el escalón 5 del
 * DDL ya vale $400,000 de pago único, así que el techo de los hitos
 * ($1,000,000) deja apenas 2.5× de margen y cualquier renegociación al alza
 * chocaría contra la validación en vez de contra una decisión de negocio. Sigue
 * siendo un techo —un cero de más al teclear se rechaza— pero holgado de
 * verdad.
 */
const MAX_NETWORK_BONUS_MXN = 5000000;

/**
 * Umbral máximo de clínicas de un escalón de red. Es EL MISMO límite que el de
 * los hitos y por eso es un alias y no un número tecleado otra vez: los dos
 * cuentan clínicas con el mismo criterio (@/lib/affiliates/qualifying-clinic) y
 * si algún día se sube, se sube en un solo sitio.
 */
const MAX_NETWORK_CLINICS = MAX_MILESTONE_CLINICS;

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Los bonos por red se leen APARTE y no dentro del try de abajo. El motivo es
  // concreto: el `findUnique` de la fila id=1 va SIN `select`, así que Prisma
  // pide TODAS las columnas del modelo — incluidas las de los bonos por red.
  // Si sql/afiliados-bonos-red.sql no se ha corrido, esa lectura falla entera y
  // el GET caería al catch, dejando a Rafael sin ver tampoco su esquema de pago
  // ni sus hitos (que sí están guardados). `getNetworkBonusConfig()` usa un
  // `select` acotado a las 11 columnas vivas y su propio try/catch: devuelve
  // null en vez de lanzar, así que un deploy adelantado al SQL apaga SOLO este
  // bloque.
  const [plans, networkRow] = await Promise.all([loadPlans(), getNetworkBonusConfig()]);
  const networkBonus: NetworkBonusConfig = networkRow ?? { ...DEFAULT_NETWORK_BONUS };
  const networkBonusExists = networkRow !== null;

  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    // Tabla viva: con fila → config real; sin fila → defaults (exists true).
    const body: AdminPayoutConfigResponse = {
      config: row ? toPayoutConfig(row) : { ...DEFAULT_PAYOUT_CONFIG },
      milestones: row ? normalizeMilestones(row) : { ...DEFAULT_MILESTONES },
      networkBonus,
      exists: true,
      networkBonusExists,
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
      networkBonus,
      exists: false,
      networkBonusExists,
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

  // ── Bonos por red ──────────────────────────────────────────────────────
  // Estos SÍ los calcula y los paga una máquina (el cron mensual de
  // @/lib/affiliates/network-bonus), así que un número mal guardado aquí no es
  // una promesa comercial rota: es dinero que sale. Se valida campo por campo
  // iterando NETWORK_TIER_KEYS — nunca cinco bloques copiados, que es como se
  // cuela un "networkTier3OnceMxn" validado contra el umbral del escalón 4.
  //
  // Son 11 campos, no 16: el bono por red se cobra en PAGO ÚNICO y punto. Las
  // cinco `networkTier<N>MonthlyMxn` quedaron en la BD en 0 al retirarse la
  // modalidad mensual (ago 2026) y este PUT ni las valida ni las escribe —
  // tampoco para ponerlas a 0. Una columna que ninguna escritura menciona es
  // una columna que ya no puede resucitar por accidente.
  const networkBonusEnabled = body?.networkBonusEnabled;
  if (typeof networkBonusEnabled !== "boolean") {
    return NextResponse.json(
      { error: "El interruptor de los bonos por red debe ser verdadero o falso" },
      { status: 400 }
    );
  }

  const network: Record<string, number> = {};
  for (const key of NETWORK_TIER_KEYS) {
    const clinics = Number(body?.[key.clinics]);
    if (!Number.isInteger(clinics) || clinics < 1 || clinics > MAX_NETWORK_CLINICS) {
      return NextResponse.json(
        {
          error: `Escalón ${key.n} de red: las clínicas deben ser un entero entre 1 y ${MAX_NETWORK_CLINICS}`,
        },
        { status: 400 }
      );
    }
    const once = Number(body?.[key.once]);
    if (!Number.isFinite(once) || once < 0 || once > MAX_NETWORK_BONUS_MXN) {
      return NextResponse.json(
        {
          error: `Escalón ${key.n} de red: el pago único debe ser un monto entre 0 y ${MAX_NETWORK_BONUS_MXN} MXN`,
        },
        { status: 400 }
      );
    }
    network[key.clinics] = clinics;
    network[key.once] = once;
  }

  // Los 5 umbrales, en orden ESTRICTAMENTE creciente. No es cosmética: el cron
  // recorre los escalones y otorga TODOS los que el conteo alcanza, así que dos
  // umbrales iguales (o al revés) entregarían dos bonos por el mismo logro. Se
  // compara por pares consecutivos sobre NETWORK_TIER_KEYS y el mensaje dice
  // exactamente cuál escalón está mal, con los dos números a la vista.
  for (let i = 1; i < NETWORK_TIER_KEYS.length; i++) {
    const prevKey = NETWORK_TIER_KEYS[i - 1];
    const curKey = NETWORK_TIER_KEYS[i];
    const prevClinics = network[prevKey.clinics];
    const curClinics = network[curKey.clinics];
    if (!(prevClinics < curClinics)) {
      return NextResponse.json(
        {
          error:
            `Escalón ${curKey.n} de red: su umbral (${curClinics} clínicas) debe ser MAYOR que el del ` +
            `escalón ${prevKey.n} (${prevClinics} clínicas). Los cinco escalones van de menor a mayor.`,
        },
        { status: 400 }
      );
    }
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
    // Las 11 VIVAS de los bonos por red, escritas una por una a propósito
    // (mismo criterio que los hitos de arriba): un `...network` metería un
    // Record<string, number> en el input de Prisma y perdería la comprobación
    // de que están las 11 y solo las 11. Las cinco columnas de la modalidad
    // mensual NO aparecen aquí ni con un 0: se quedan como están.
    networkBonusEnabled,
    networkTier1Clinics: network.networkTier1Clinics,
    networkTier1OnceMxn: network.networkTier1OnceMxn,
    networkTier2Clinics: network.networkTier2Clinics,
    networkTier2OnceMxn: network.networkTier2OnceMxn,
    networkTier3Clinics: network.networkTier3Clinics,
    networkTier3OnceMxn: network.networkTier3OnceMxn,
    networkTier4Clinics: network.networkTier4Clinics,
    networkTier4OnceMxn: network.networkTier4OnceMxn,
    networkTier5Clinics: network.networkTier5Clinics,
    networkTier5OnceMxn: network.networkTier5OnceMxn,
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
      // El `before` incluye los hitos Y los bonos por red: si no, el log diría
      // que aparecieron de la nada en cada guardado. `normalizeNetworkBonus`
      // rellena con los defaults del DDL lo que la fila no traiga, así que el
      // diff nunca queda con huecos.
      before: prev
        ? { ...toPayoutConfig(prev), ...normalizeMilestones(prev), ...normalizeNetworkBonus(prev) }
        : null,
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
      // Se devuelve lo GUARDADO (la fila releída), no lo enviado: si algún día
      // la BD normalizara un valor, la pantalla se queda con la verdad.
      networkBonus: normalizeNetworkBonus(row),
      revalidated,
    });
  } catch {
    // Tabla (o columnas) inexistentes: el admin ve el aviso y sabe qué correr.
    // El upsert escribe las 11 columnas vivas de los bonos por red, así que un
    // deploy adelantado a sql/afiliados-bonos-red.sql aterriza EXACTAMENTE aquí
    // — por eso ese archivo también se nombra, o el admin correría los otros dos
    // y seguiría sin poder guardar.
    return NextResponse.json(
      {
        error:
          "Corre sql/afiliados-comisiones.sql, sql/afiliados-hitos.sql y sql/afiliados-bonos-red.sql en Supabase",
      },
      { status: 503 }
    );
  }
}
