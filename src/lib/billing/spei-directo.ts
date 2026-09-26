import "server-only";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPlanLimits, getResolvedPlan } from "@/lib/plans";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { manualPeriodFields } from "@/lib/billing/proration";
import { ivaAplica } from "@/lib/billing/iva-cobro";
import { exencionIvaDeClinica } from "@/lib/billing/iva-clinica";
import { sendEmail, sendPlanActivatedEmail } from "@/lib/email";
import {
  ALFABETO_REFERENCIA,
  LARGO_REFERENCIA,
  centavosAMxn,
  cuentaUsable,
  importeSpei,
  periodoPagado,
  type CuentaBancaria,
  type PeriodoPago,
} from "./spei-directo-core";

/**
 * SPEI por TRANSFERENCIA DIRECTA — parte con base de datos.
 * Reglas puras (importe, CLABE, referencia, periodo): `spei-directo-core.ts`.
 *
 * Tablas nuevas (sql/spei-transferencia-directa.sql, a mano por Rafael):
 *   · platform_bank_accounts  → la cuenta a la que se transfiere (una fila).
 *   · spei_transfer_requests  → una fila por «Ya hice la transferencia».
 * Sin el SQL nada se rompe: leer devuelve «no hay cuenta», así que la pantalla
 * de pago simplemente NO ofrece SPEI (ver `esTablaInexistente`).
 *
 * Aislamiento: todo lo de una clínica se filtra por el `clinicId` que llega de
 * la sesión (nunca del cliente) y se corta ANTES de consultar si falta —
 * `clinicId: undefined` haría que Prisma devolviera las filas de todas.
 */

const ID_CUENTA = "spei";

export class SpeiError extends Error {
  constructor(
    public readonly codigo: "no-disponible" | "plan-invalido" | "no-encontrada" | "ya-resuelta" | "sin-clinica" | "precio-cambio",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "SpeiError";
  }
}

/** P2021 / P2010 (42P01): la tabla aún no existe → el SQL no se ha pegado. */
function esTablaInexistente(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { code?: string } } | null;
  return (
    e?.code === "P2021" ||
    e?.meta?.code === "42P01" ||
    /relation "[^"]*" does not exist|does not exist in the current database/i.test(e?.message ?? "")
  );
}

/**
 * También cuenta como «aún no hay tabla» un cliente Prisma sin regenerar (el
 * delegado del modelo nuevo no existe → TypeError): pasa en un `next dev` que
 * arrancó antes de `prisma generate`. En producción `npm run build` genera el
 * cliente, así que ahí solo aplica la primera condición.
 */
function clienteSinRegenerar(err: unknown): boolean {
  return err instanceof TypeError && /reading '(findUnique|findFirst|findMany|count|upsert|create)'/.test(err.message);
}

async function sinTabla<T>(fn: () => Promise<T>, vacio: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (esTablaInexistente(err) || clienteSinRegenerar(err)) return vacio;
    throw err;
  }
}

// ── Cuenta de la plataforma ──────────────────────────────────────────────

/** La cuenta configurada en /admin, o null si falta / está incompleta / CLABE inválida. */
export async function leerCuentaSpei(): Promise<CuentaBancaria | null> {
  const fila = await sinTabla(
    () => prisma.platformBankAccount.findUnique({ where: { id: ID_CUENTA } }),
    null,
  );
  return cuentaUsable(fila) ? { banco: fila.banco, beneficiario: fila.beneficiario, clabe: fila.clabe } : null;
}

/** Igual que leerCuentaSpei pero devuelve lo guardado aunque esté incompleto (para el editor de /admin). */
export async function leerCuentaSpeiParaEditar(): Promise<
  (Partial<CuentaBancaria> & { updatedAt: string | null }) | null
> {
  const fila = await sinTabla(
    () => prisma.platformBankAccount.findUnique({ where: { id: ID_CUENTA } }),
    null,
  );
  return fila
    ? { banco: fila.banco, beneficiario: fila.beneficiario, clabe: fila.clabe, updatedAt: fila.updatedAt.toISOString() }
    : null;
}

export async function guardarCuentaSpei(cuenta: CuentaBancaria, adminId: string): Promise<void> {
  await prisma.platformBankAccount.upsert({
    where: { id: ID_CUENTA },
    create: { id: ID_CUENTA, ...cuenta, updatedBy: adminId },
    update: { ...cuenta, updatedBy: adminId },
  });
}

// ── Referencia ───────────────────────────────────────────────────────────

/**
 * Folio estable de la clínica para el concepto de la transferencia (ver
 * spei-directo-core: referenciaValida). Sale del id de la clínica —que viene de
 * la sesión— con sha256, así que se muestra antes de transferir sin guardar
 * nada y es el mismo en cada pago.
 */
export function referenciaDeClinica(clinicId: string): string {
  const h = createHash("sha256").update(`spei:${clinicId}`).digest();
  let s = "";
  for (let i = 0; i < LARGO_REFERENCIA; i++) s += ALFABETO_REFERENCIA[h[i] % ALFABETO_REFERENCIA.length];
  return "DC" + s;
}

// ── Solicitudes ──────────────────────────────────────────────────────────

export interface SolicitudSpeiDTO {
  id: string;
  clinicId: string;
  plan: string;
  billing: PeriodoPago;
  subtotalCents: number;
  ivaCents: number;
  amountCents: number;
  reference: string;
  status: string;
  banco: string;
  beneficiario: string;
  clabe: string;
  createdAt: string;
  rejectReason: string | null;
  resolvedAt: string | null;
}

type Fila = NonNullable<Awaited<ReturnType<typeof prisma.speiTransferRequest.findFirst>>>;

function aDTO(f: Fila): SolicitudSpeiDTO {
  const snap = (f.bankSnapshot ?? {}) as Partial<CuentaBancaria>;
  return {
    id: f.id,
    clinicId: f.clinicId,
    plan: f.plan,
    billing: f.billing === "annual" ? "annual" : "monthly",
    subtotalCents: f.subtotalCents,
    ivaCents: f.ivaCents,
    amountCents: f.amountCents,
    reference: f.reference,
    status: f.status,
    banco: snap.banco ?? "",
    beneficiario: snap.beneficiario ?? "",
    clabe: snap.clabe ?? "",
    createdAt: f.createdAt.toISOString(),
    rejectReason: f.rejectReason ?? null,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
  };
}

/** Una pendiente más vieja que esto se da por abandonada (la clínica pagó por otro medio y venció meses después). */
export const DIAS_PENDIENTE_VIGENTE = 30;

/**
 * La transferencia que la clínica declaró y aún no se confirma (una a la vez).
 * Solo cuenta la VIGENTE (≤ 30 días): una pendiente vieja que nadie resolvió no
 * debe tapar la pantalla de pago de una clínica que volvió a vencer. Declarar
 * de nuevo la sustituye (ver crearSolicitudSpei).
 */
export async function solicitudPendienteDe(
  clinicId: string | null | undefined,
  ahora = new Date(),
): Promise<SolicitudSpeiDTO | null> {
  if (!clinicId) return null;
  const desde = new Date(ahora.getTime() - DIAS_PENDIENTE_VIGENTE * 86_400_000);
  const f = await sinTabla(
    () =>
      prisma.speiTransferRequest.findFirst({
        where: { clinicId, status: "pending", createdAt: { gte: desde } },
        orderBy: { createdAt: "desc" },
      }),
    null,
  );
  return f ? aDTO(f) : null;
}

/** La última rechazada y reciente, para avisar a la clínica por qué volvió a la pantalla de pago. */
export async function rechazoReciente(
  clinicId: string | null | undefined,
  dias = 14,
  ahora = new Date(),
): Promise<SolicitudSpeiDTO | null> {
  if (!clinicId) return null;
  const desde = new Date(ahora.getTime() - dias * 86_400_000);
  const f = await sinTabla(
    () =>
      prisma.speiTransferRequest.findFirst({
        where: { clinicId, createdAt: { gte: desde } },
        orderBy: { createdAt: "desc" },
      }),
    null,
  );
  // Solo si la MÁS reciente es un rechazo: una nueva solicitud o un pago posterior lo sustituyen.
  return f && f.status === "rejected" ? aDTO(f) : null;
}

/**
 * EL plan (precio incluido) que SPEI cobra: el único punto donde se decide.
 * Hoy es el de plan_configs, igual que /api/billing/checkout.
 *
 * ⚠️ INTEGRACIÓN con feat/planes-nuevos (PR #425): esa rama hace que el checkout
 * cobre `applyClinicOverrides(getResolvedPlan(plan), clinic)` (las clínicas de
 * antes conservan su precio). Al integrarla, ESTA función debe hacer lo mismo
 * —leer la clínica con CLINIC_OVERRIDE_SELECT y aplicar los overrides—, o SPEI
 * cobraría distinto que la tarjeta. La pantalla de pago ya muestra el precio
 * conservado (esa rama también se lo aplica a `planCards` en page.tsx).
 */
async function planACobrar(_clinicId: string, planId: PlanId) {
  return getResolvedPlan(planId);
}

/**
 * Registra «Ya hice la transferencia». El importe se calcula AQUÍ, en el
 * servidor, con el precio de plan_configs: lo que mande el cliente (más allá de
 * plan y periodo) no cuenta. Si ya hay una pendiente se devuelve esa: doble
 * clic o segunda pestaña no crean dos.
 */
export async function crearSolicitudSpei(args: {
  clinicId: string | null | undefined;
  userId?: string | null;
  plan: string;
  billing: PeriodoPago;
  /** Lo que la pantalla le enseñó a la clínica: si ya no coincide con el precio de hoy, 409. */
  amountCentsEsperado?: number;
}): Promise<{ solicitud: SolicitudSpeiDTO; creada: boolean }> {
  const { clinicId } = args;
  if (!clinicId) throw new SpeiError("sin-clinica", "Sesión sin clínica");
  if (!isPlanId(args.plan)) throw new SpeiError("plan-invalido", "Plan inválido");

  const cuenta = await leerCuentaSpei();
  if (!cuenta) throw new SpeiError("no-disponible", "El pago por transferencia no está disponible por ahora.");

  const plan = await planACobrar(clinicId, args.plan);
  // IVA 16 % salvo el mismo plan de una clínica creada antes del corte (ver iva-cobro.ts).
  // La clínica se lee por el clinicId de la sesión; sin ella, la clínica cuenta como nueva (con IVA).
  const clinicaIva = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, createdAt: true, plan: true, stripeSubscriptionId: true, subscriptionId: true },
  });
  const conIva = ivaAplica({ metodo: "spei", plan: plan.id, exencion: await exencionIvaDeClinica(clinicaIva) });
  const importe = importeSpei({ plan, billing: args.billing, conIva });
  if (args.amountCentsEsperado !== undefined && args.amountCentsEsperado !== importe.totalCents) {
    throw new SpeiError("precio-cambio", "El precio cambió mientras tenías la pantalla abierta. Recarga la página y revisa el importe.");
  }
  const datos = {
    plan: plan.id,
    billing: args.billing,
    subtotalCents: importe.subtotalCents,
    ivaCents: importe.ivaCents,
    amountCents: importe.totalCents,
    bankSnapshot: { ...cuenta },
  };

  // ¿Ya hay una pendiente (vigente o vieja)? Con los mismos datos se devuelve tal cual (doble clic, otra
  // pestaña). Con OTRO plan o periodo se ACTUALIZA mientras siga pendiente: la clínica transfiere lo que
  // ve en pantalla, y la solicitud tiene que decir lo mismo que el importe que acaba de copiar.
  const previa = await sinTabla(
    () => prisma.speiTransferRequest.findFirst({ where: { clinicId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    null,
  );
  if (previa) {
    const igual =
      previa.plan === datos.plan && previa.billing === datos.billing && previa.amountCents === datos.amountCents &&
      Date.now() - previa.createdAt.getTime() < DIAS_PENDIENTE_VIGENTE * 86_400_000;
    if (igual) return { solicitud: aDTO(previa), creada: false };
    const r = await prisma.speiTransferRequest.updateMany({
      where: { id: previa.id, clinicId, status: "pending" },
      data: { ...datos, createdAt: new Date(), requestedBy: args.userId ?? null },
    });
    if (r.count === 1) {
      const f = await prisma.speiTransferRequest.findUnique({ where: { id: previa.id } });
      if (f) {
        const dto = aDTO(f);
        await avisarAlAdmin(dto, clinicId);
        return { solicitud: dto, creada: true };
      }
    }
    // Se resolvió entre la lectura y la actualización: se sigue como si no hubiera pendiente.
  }

  try {
    const f = await prisma.speiTransferRequest.create({
      data: {
        clinicId,
        requestedBy: args.userId ?? null,
        ...datos,
        reference: referenciaDeClinica(clinicId),
        status: "pending",
      },
    });
    const dto = aDTO(f);
    // Con await: en serverless, una promesa suelta puede morir con la respuesta y el aviso no salir.
    await avisarAlAdmin(dto, clinicId);
    return { solicitud: dto, creada: true };
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    // Carrera: otra petición creó la pendiente de esta clínica (índice único parcial).
    const otra = await solicitudPendienteDe(clinicId);
    if (otra) return { solicitud: otra, creada: false };
    throw err;
  }
}

// ── Lista del admin ──────────────────────────────────────────────────────

export interface PendienteAdminDTO extends SolicitudSpeiDTO {
  clinicName: string;
  clinicEmail: string | null;
  /** La clínica ya está activa (pagó por otro medio): confirmar sería un segundo periodo. */
  clinicaYaActiva: boolean;
  /** Tiene una suscripción de tarjeta que Stripe sigue cobrando: confirmar no la cancela (riesgo de doble cobro). */
  suscripcionTarjetaViva: boolean;
}

export async function listarPendientesAdmin(): Promise<PendienteAdminDTO[]> {
  const filas = await sinTabla(
    () => prisma.speiTransferRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 200 }),
    [] as Fila[],
  );
  if (filas.length === 0) return [];
  const ids = Array.from(new Set(filas.map((f) => f.clinicId)));
  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, subscriptionStatus: true, stripeSubscriptionId: true },
  });
  const porId = new Map(clinicas.map((c) => [c.id, c]));
  return filas.map((f) => {
    const c = porId.get(f.clinicId);
    const activa = !!c && c.subscriptionStatus === "active";
    const tarjetaViva = !!c?.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(c.subscriptionStatus ?? "");
    return { ...aDTO(f), clinicName: c?.name ?? "—", clinicEmail: c?.email ?? null, clinicaYaActiva: activa, suscripcionTarjetaViva: tarjetaViva };
  });
}

export async function contarPendientes(): Promise<number> {
  return sinTabla(() => prisma.speiTransferRequest.count({ where: { status: "pending" } }), 0);
}

// ── Confirmar / rechazar ─────────────────────────────────────────────────

export interface ResultadoConfirmacion {
  clinicId: string;
  invoiceId: string;
  plan: PlanId;
  billing: PeriodoPago;
  amountCents: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Confirmar = lo mismo que el SPEI de Stripe al acreditarse
 * (`activatePlatformSubscription`) y que un pago manual del admin:
 *   · SubscriptionInvoice pagada (method "transfer", referencia = la de la
 *     solicitud) — así entra en «Cobrado este mes» y en el historial;
 *   · la clínica pasa a "active" con el plan que pagó y el cupo de IA de ese plan;
 *   · el periodo se extiende desde el final del vigente (mes o año), y las dos
 *     fechas (trialEndsAt = «acceso hasta» y nextBillingDate) se mueven juntas
 *     con `manualPeriodFields`, que nunca acorta lo que ya tenía.
 * No toca `monthlyPrice` (el MRR usa el precio de lista; el importe anual no es
 * un precio mensual). Todo va en UNA transacción (ver abajo).
 */
export async function confirmarSolicitudSpei(id: string, adminId: string): Promise<ResultadoConfirmacion> {
  const sol = await prisma.speiTransferRequest.findUnique({ where: { id } });
  if (!sol) throw new SpeiError("no-encontrada", "Solicitud no encontrada");
  if (sol.status !== "pending") throw new SpeiError("ya-resuelta", "Esta transferencia ya se había resuelto.");

  const plan = isPlanId(sol.plan) ? sol.plan : null;
  if (!plan) throw new SpeiError("plan-invalido", "La solicitud tiene un plan inválido");
  const billing: PeriodoPago = sol.billing === "annual" ? "annual" : "monthly";

  const clinica = await prisma.clinic.findUnique({
    where: { id: sol.clinicId },
    select: { trialEndsAt: true, nextBillingDate: true, subscriptionStatus: true, stripeSubscriptionId: true },
  });
  if (!clinica) throw new SpeiError("no-encontrada", "La clínica ya no existe");
  // Una suscripción de tarjeta CANCELADA deja su id en la clínica (el webhook no lo limpia). Si se
  // quedara, la clínica activa por SPEI nunca vencería (el cron de vencimiento solo mira las que no
  // tienen suscripción de Stripe): un solo pago daría acceso indefinido. Se suelta el id muerto.
  const suscripcionMuerta = !!clinica.stripeSubscriptionId && ["cancelled", "canceled"].includes(clinica.subscriptionStatus ?? "");

  const ahora = new Date();
  const { desde, hasta } = periodoPagado(ahora, clinica, billing);
  const { aiTokensDefault } = await getPlanLimits(plan);

  // Una transacción interactiva: primero se RECLAMA la solicitud (solo si sigue
  // pendiente) y solo entonces se escribe lo demás. Si otra confirmación o un
  // rechazo se adelantó, no se escribe nada. La referencia única de la factura
  // es un segundo candado contra dos confirmaciones simultáneas.
  let factura: { id: string };
  try {
    factura = await prisma.$transaction(
      async (tx) => {
        const reclamada = await tx.speiTransferRequest.updateMany({
          where: { id: sol.id, status: "pending" },
          data: { status: "confirmed", resolvedAt: ahora, resolvedBy: adminId },
        });
        if (reclamada.count !== 1) throw new SpeiError("ya-resuelta", "Esta transferencia ya se había resuelto.");
        const f = await tx.subscriptionInvoice.create({
          data: {
            clinicId: sol.clinicId,
            amount: sol.amountCents / 100,
            currency: "MXN",
            status: "paid",
            method: "transfer",
            reference: `${sol.reference}-${sol.id.slice(-5)}`,
            periodStart: desde,
            periodEnd: hasta,
            paidAt: ahora,
            notes: `SPEI directo · ${plan} · ${billing === "annual" ? "anual" : "mensual"} · ${centavosAMxn(sol.amountCents)} MXN`,
          },
        });
        await tx.clinic.update({
          where: { id: sol.clinicId },
          data: {
            subscriptionStatus: "active",
            plan,
            aiTokensLimit: aiTokensDefault,
            ...(suscripcionMuerta ? { stripeSubscriptionId: null } : {}),
            ...manualPeriodFields(clinica, hasta),
          },
        });
        await tx.speiTransferRequest.update({ where: { id: sol.id }, data: { invoiceId: f.id } });
        return f;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") throw new SpeiError("ya-resuelta", "Esta transferencia ya se había resuelto.");
    throw err;
  }
  await avisarActivacion(sol.clinicId, plan);

  return { clinicId: sol.clinicId, invoiceId: factura.id, plan, billing, amountCents: sol.amountCents, periodStart: desde, periodEnd: hasta };
}

export async function rechazarSolicitudSpei(
  id: string,
  adminId: string,
  motivo: string,
): Promise<{ clinicId: string; reference: string }> {
  const r = await prisma.speiTransferRequest.updateMany({
    where: { id, status: "pending" },
    data: { status: "rejected", resolvedAt: new Date(), resolvedBy: adminId, rejectReason: motivo.trim().slice(0, 300) },
  });
  const sol = await prisma.speiTransferRequest.findUnique({ where: { id }, select: { clinicId: true, reference: true } });
  if (!sol) throw new SpeiError("no-encontrada", "Solicitud no encontrada");
  if (r.count !== 1) throw new SpeiError("ya-resuelta", "Esta transferencia ya se había resuelto.");
  return sol;
}

// ── Avisos (jamás tiran: el pago no depende de un correo) ────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Mismo buzón que el aviso de afiliados: ADMIN_NOTIFY_EMAIL, o el general. */
async function avisarAlAdmin(s: SolicitudSpeiDTO, clinicId: string): Promise<void> {
  try {
    const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, email: true } });
    const nombre = c?.name ?? clinicId;
    const periodo = s.billing === "annual" ? "anual" : "mensual";
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
    const url = `${base}/admin/payments`;
    const monto = centavosAMxn(s.amountCents);
    await sendEmail({
      to: process.env.ADMIN_NOTIFY_EMAIL?.trim() || "hola@dalecontrol.com",
      subject: `Transferencia SPEI por confirmar: ${nombre} · ${monto}`,
      html:
        `<p><strong>${esc(nombre)}</strong> avisó que ya hizo una transferencia.</p>` +
        `<p>Plan ${esc(s.plan)} (${periodo}) · <strong>${esc(monto)} MXN</strong><br/>` +
        `Referencia en el concepto: <strong>${esc(s.reference)}</strong></p>` +
        `<p>Revísala en tu banco y confírmala en <a href="${url}">${url}</a>.</p>`,
      text:
        `${nombre} avisó que ya hizo una transferencia.\n` +
        `Plan ${s.plan} (${periodo}) · ${monto} MXN\nReferencia: ${s.reference}\n\nConfírmala en ${url}`,
    });
  } catch (err) {
    console.error("[spei-directo] avisarAlAdmin:", err);
  }
}

async function avisarActivacion(clinicId: string, plan: PlanId): Promise<void> {
  try {
    const [c, p] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, email: true } }),
      getResolvedPlan(plan),
    ]);
    if (!c?.email) return;
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
    await sendPlanActivatedEmail({
      email: c.email,
      clinicName: c.name,
      planName: p.name,
      dashboardUrl: `${base}/dashboard`,
    });
  } catch (err) {
    console.error("[spei-directo] avisarActivacion:", err);
  }
}
