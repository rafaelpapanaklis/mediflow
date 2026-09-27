// Anticipo pedido DESDE EL PANEL (cita o factura) — ws1-t3 fase 1.
//
// Reutiliza el rail del anticipo por WhatsApp (WS1-T5, servicio.server.ts):
// misma cuenta de Mercado Pago de la clínica, mismo apartado (holdExpiresAt +
// trigger + cron), mismo webhook (`ref=anticipo:<depositId>`). Lo nuevo:
//   · el anticipo se pide a mano, con un monto que recepción escribe (el
//     SERVIDOR lo valida siempre: 10 ≤ monto ≤ total − pagado de la factura);
//   · queda ligado a una FACTURA (invoiceId): al pagarse, `aplicarPagoDeAnticipo`
//     (servicio.server.ts) lo aplica ahí como Payment, no como saldo a favor;
//   · el plazo es el de Configuración → Anticipos → panel (1–48 h), no el del
//     bot.
//
// Todo lo que toca base o red entra por `DepsAnticipoPanel`: las pruebas lo
// conducen con una base en memoria y un Mercado Pago de mentira, igual que
// anticipos/servicio.server.ts y factura-mp/servicio.server.ts.

// Sin "server-only" a propósito (mismo criterio que anticipos/servicio.server.ts
// y factura-mp/servicio.server.ts): así los tests lo cargan con tsx/node:test
// sin arrastrar el stub de Next para ese paquete.
import { prisma } from "@/lib/prisma";
import { createPreference, expirePreference } from "@/lib/mercadopago";
import type { CreatePreferenceOptions, CreatePreferenceResult } from "@/lib/mercadopago";
import { credencialDeCobro, plataformaAnticipos, urlBaseApp, type CredencialDeCobro } from "./cuenta.server";
import {
  PANEL_HORAS_DEFAULT,
  calcularComision,
  redondear2,
  refDeAnticipo,
  sugeridoAnticipoPanel,
  validarMontoAnticipoManual,
  validarPlazoPanelHoras,
  type ModoAnticipoPanel,
  type ModoComision,
  type PoliticaAnticipoPanel,
} from "./core";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";

type Db = typeof prisma;

export interface DepsAnticipoPanel {
  db: Db;
  plataformaLista: () => boolean;
  credencial: (clinicId: string) => Promise<CredencialDeCobro | null>;
  crearPreferencia: (token: string, opts: CreatePreferenceOptions) => Promise<CreatePreferenceResult>;
  expirarPreferencia: (token: string, preferenceId: string) => Promise<void>;
  ahora: () => Date;
  baseUrl: () => string | null;
}

export const depsReales: DepsAnticipoPanel = {
  db: prisma,
  plataformaLista: () => plataformaAnticipos().lista,
  credencial: (clinicId) => credencialDeCobro(clinicId),
  crearPreferencia: createPreference,
  expirarPreferencia: (token, id) => expirePreference(token, id),
  ahora: () => new Date(),
  baseUrl: urlBaseApp,
};

function deps(over?: Partial<DepsAnticipoPanel>): DepsAnticipoPanel {
  return over ? { ...depsReales, ...over } : depsReales;
}

/** Tabla o columna que todavía no existe (el SQL va por detrás del deploy). */
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

// ── 1. La política vigente y el sugerido ────────────────────────────────────

const POLITICA_VACIA: PoliticaAnticipoPanel = { modo: "fixed", monto: 0, porcentaje: 0, horas: PANEL_HORAS_DEFAULT };

/** La config del panel de esta clínica (Configuración → Anticipos → panel). */
export async function leerPoliticaPanelVigente(
  clinicId: string,
  over?: Partial<DepsAnticipoPanel>,
): Promise<PoliticaAnticipoPanel> {
  const d = deps(over);
  if (!clinicId) return POLITICA_VACIA;
  try {
    const fila = await d.db.clinicMercadoPago.findUnique({
      where: { clinicId },
      select: { panelDepositMode: true, panelDepositAmount: true, panelDepositPercent: true, panelDepositExpiryHours: true },
    });
    if (!fila) return POLITICA_VACIA;
    return {
      modo: (fila.panelDepositMode as ModoAnticipoPanel) ?? "fixed",
      monto: fila.panelDepositAmount ?? 0,
      porcentaje: fila.panelDepositPercent ?? 0,
      horas: fila.panelDepositExpiryHours ?? PANEL_HORAS_DEFAULT,
    };
  } catch (e) {
    if (faltaTabla(e)) return POLITICA_VACIA;
    throw e;
  }
}

/** ¿Esta clínica puede pedir anticipos desde el panel? (cuenta de MP conectada). */
export async function anticipoPanelDisponible(clinicId: string, over?: Partial<DepsAnticipoPanel>): Promise<boolean> {
  const d = deps(over);
  if (!clinicId || !d.plataformaLista() || !d.baseUrl()) return false;
  try {
    return !!(await d.credencial(clinicId));
  } catch {
    return false;
  }
}

/** El monto sugerido para prefijar el modal, dado el total de la factura. */
export async function sugeridoParaFactura(
  clinicId: string,
  totalFactura: number,
  over?: Partial<DepsAnticipoPanel>,
): Promise<{ monto: number | null; horas: number }> {
  const politica = await leerPoliticaPanelVigente(clinicId, over);
  return { monto: sugeridoAnticipoPanel(politica, totalFactura), horas: politica.horas };
}

export interface EstadoAnticipoFactura {
  pendiente: AnticipoPedido | null;
  /** Σ de lo pagado de los anticipos PAID de esta factura (Total / Anticipo / Pendiente). */
  anticipoPagado: number;
}

/**
 * Lo que el detalle de la factura (y su GET de estado) necesitan de
 * appointment_deposits — EN SU PROPIA FUNCIÓN, con la MISMA tolerancia a
 * P2022 que el resto del módulo: dev.108 apunta a producción, y sin
 * sql/anticipo-desde-panel.sql aplicado esto se calla (sin pendiente, sin
 * anticipo pagado) en vez de tumbar el detalle de una factura que hoy sí
 * carga.
 */
export async function estadoAnticipoDeFactura(
  clinicId: string,
  invoiceId: string,
  over?: Partial<DepsAnticipoPanel>,
): Promise<EstadoAnticipoFactura> {
  const d = deps(over);
  const vacio: EstadoAnticipoFactura = { pendiente: null, anticipoPagado: 0 };
  if (!clinicId || !invoiceId) return vacio;
  try {
    const [pendiente, pagados] = await Promise.all([
      d.db.appointmentDeposit.findFirst({
        where: { clinicId, invoiceId, status: "PENDING" },
        select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true },
      }),
      d.db.appointmentDeposit.findMany({
        where: { clinicId, invoiceId, status: "PAID" },
        select: { paidAmount: true },
      }),
    ]);
    return {
      pendiente: pendiente?.checkoutUrl
        ? {
            id: pendiente.id,
            invoiceId,
            amount: redondear2(pendiente.amount),
            expiresAt: pendiente.expiresAt.toISOString(),
            checkoutUrl: pendiente.checkoutUrl,
            apartada: !!pendiente.appointmentId,
          }
        : null,
      anticipoPagado: pagados.reduce((acc: number, p: { paidAmount: number | null }) => acc + (p.paidAmount ?? 0), 0),
    };
  } catch (e) {
    if (faltaTabla(e)) return vacio;
    throw e;
  }
}

// ── 2. Pedirlo ───────────────────────────────────────────────────────────────

export type ErrorPedirAnticipo =
  | "sin_mp"
  | "no_encontrada"
  | "estado"
  | "sin_saldo"
  | "sin_concepto"
  | "monto_invalido"
  | "plazo_invalido"
  | "mp_fallo";

export interface AnticipoPedido {
  id: string;
  invoiceId: string;
  amount: number;
  expiresAt: string;
  checkoutUrl: string;
  /** true = además dejó la cita apartada (holdExpiresAt) para ese doctor y sillón. */
  apartada: boolean;
}

/**
 * UN SOLO TIPO, sin unión: el repo no compila en `strict` y no estrecha bien
 * por `ok` (mismo criterio que `ResultadoLink` en factura-mp/servicio.server.ts).
 */
export interface ResultadoPedirAnticipo {
  ok: boolean;
  error: ErrorPedirAnticipo | null;
  motivo: string | null;
  deposit: AnticipoPedido | null;
  reutilizado: boolean;
}

/** Estados de factura sobre los que se puede pedir anticipo (mismo criterio que el link de saldo). */
const ESTADOS_COBRABLES = ["PENDING", "PARTIAL", "OVERDUE"];

function fallo(error: ErrorPedirAnticipo, motivo?: string): ResultadoPedirAnticipo {
  return { ok: false, error, motivo: motivo ?? null, deposit: null, reutilizado: false };
}

function listo(deposit: AnticipoPedido, reutilizado: boolean): ResultadoPedirAnticipo {
  return { ok: true, error: null, motivo: null, deposit, reutilizado };
}

/**
 * Pide un anticipo por Mercado Pago sobre el SALDO PARCIAL de una factura.
 *
 * · El monto SIEMPRE se valida en el servidor: 10 ≤ monto ≤ total − pagado
 *   (`validarMontoAnticipoManual`), pase lo que pase en el body.
 * · Si ya hay un anticipo PENDING para esta factura, se devuelve TAL CUAL
 *   (nunca se crea un segundo link con otro monto): el índice único parcial
 *   de la base es el candado final, pero se comprueba antes para no fallar
 *   con un P2002 feo.
 * · Si la factura viene de una cita SCHEDULED, la cita queda apartada
 *   (holdExpiresAt) para ESE doctor y ESE sillón — el trigger y el cron ya
 *   existentes hacen el resto, igual que con el anticipo del bot. El plazo
 *   nunca pasa del inicio de la cita.
 */
// dev.108 apunta a la base de PRODUCCIÓN: sin sql/anticipo-desde-panel.sql
// aplicado, cualquier consulta de aquí para abajo que toque invoiceId/origin/
// method/createdById/paymentId lanza P2022. La envoltura lo convierte en un
// error legible ("sin_mp") en vez de un 500 crudo — nunca dice que se pidió
// el anticipo cuando en realidad no se guardó nada.
export async function pedirAnticipoDeFactura(
  args: { clinicId: string; invoiceId: string; userId: string; monto: number; horas?: number },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  try {
    return await pedirAnticipoDeFacturaImpl(args, over);
  } catch (e) {
    if (faltaTabla(e)) return fallo("sin_mp", "Falta aplicar la actualización de la base (sql/anticipo-desde-panel.sql).");
    throw e;
  }
}

async function pedirAnticipoDeFacturaImpl(
  args: { clinicId: string; invoiceId: string; userId: string; monto: number; horas?: number },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  const d = deps(over);
  const { clinicId, invoiceId, userId } = args;
  if (!clinicId || !invoiceId || !userId) return fallo("no_encontrada");
  if (!d.plataformaLista()) return fallo("sin_mp");
  const base = d.baseUrl();
  const cred = await d.credencial(clinicId);
  if (!cred || !base) return fallo("sin_mp");

  const inv = await d.db.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    select: { id: true, invoiceNumber: true, status: true, total: true, paid: true, patientId: true, appointmentId: true },
  });
  if (!inv) return fallo("no_encontrada");
  if (!ESTADOS_COBRABLES.includes(inv.status)) {
    return fallo("estado", "Solo se puede pedir anticipo de una factura emitida con saldo (pendiente, parcial o vencida).");
  }
  const saldo = redondear2(Math.max(0, inv.total - inv.paid));
  if (!(saldo > 0)) return fallo("sin_saldo", "La factura ya no tiene saldo por cobrar.");

  // Ya hay uno pendiente: se devuelve el mismo (nunca dos a la vez — lo
  // refuerza el índice único parcial de la base).
  const existente = await d.db.appointmentDeposit.findFirst({
    where: { invoiceId, clinicId, status: "PENDING" },
    select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true },
  });
  if (existente?.checkoutUrl) {
    return listo(
      {
        id: existente.id,
        invoiceId,
        amount: redondear2(existente.amount),
        expiresAt: existente.expiresAt.toISOString(),
        checkoutUrl: existente.checkoutUrl,
        apartada: !!existente.appointmentId,
      },
      true,
    );
  }

  const errorMonto = validarMontoAnticipoManual(args.monto, inv.total, inv.paid);
  if (errorMonto) return fallo("monto_invalido", errorMonto);
  const monto = redondear2(args.monto);

  const cuentaFila = await d.db.clinicMercadoPago.findUnique({
    where: { clinicId },
    select: { panelDepositExpiryHours: true, marketplaceFeeMode: true, marketplaceFeeValue: true },
  });
  const horas = args.horas ?? cuentaFila?.panelDepositExpiryHours ?? PANEL_HORAS_DEFAULT;
  const errorHoras = validarPlazoPanelHoras(horas);
  if (errorHoras) return fallo("plazo_invalido", errorHoras);

  // Misma comisión de DaleControl que el anticipo del bot (ClinicMercadoPago
  // es una configuración por clínica, no por origen del anticipo).
  const comision =
    calcularComision((cuentaFila?.marketplaceFeeMode as ModoComision) ?? "fixed", cuentaFila?.marketplaceFeeValue ?? 0, monto) ?? 0;

  const ahora = d.ahora();
  let apartadaAppointment: { id: string } | null = null;
  // El plazo nunca pasa del inicio de la cita: un link vivo con la cita ya
  // empezada no aparta nada (mismo criterio que crearCitaDesdeBot).
  let venceTope = Infinity;
  if (inv.appointmentId) {
    const appt = await d.db.appointment.findFirst({
      where: { id: inv.appointmentId, clinicId, status: "SCHEDULED" },
      select: { id: true, startsAt: true },
    });
    if (appt) {
      apartadaAppointment = { id: appt.id };
      venceTope = appt.startsAt.getTime();
    }
  }
  const venceMs = Math.min(ahora.getTime() + horas * 3600_000, venceTope);
  const vence = new Date(venceMs);

  let depositId: string;
  try {
    const creado = await d.db.$transaction(async (tx) => {
      const dep = await tx.appointmentDeposit.create({
        data: {
          clinicId,
          patientId: inv.patientId,
          appointmentId: apartadaAppointment?.id ?? null,
          invoiceId: inv.id,
          amount: monto,
          marketplaceFee: comision,
          currency: "MXN",
          status: "PENDING",
          expiresAt: vence,
          mpCollectorId: cred.mpUserId,
          origin: "panel",
          method: "mercadopago",
          createdById: userId,
        },
        select: { id: true },
      });
      if (apartadaAppointment) {
        await tx.appointment.updateMany({
          where: { id: apartadaAppointment.id, clinicId, status: "SCHEDULED" },
          data: { holdExpiresAt: vence },
        });
      }
      return dep;
    });
    depositId = creado.id;
  } catch (e) {
    // El índice único parcial ganó la carrera: alguien más lo pidió primero.
    if ((e as { code?: string })?.code === "P2002") {
      const otro = await d.db.appointmentDeposit.findFirst({
        where: { invoiceId, clinicId, status: "PENDING" },
        select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true },
      });
      if (otro?.checkoutUrl) {
        return listo(
          {
            id: otro.id,
            invoiceId,
            amount: redondear2(otro.amount),
            expiresAt: otro.expiresAt.toISOString(),
            checkoutUrl: otro.checkoutUrl,
            apartada: !!otro.appointmentId,
          },
          true,
        );
      }
    }
    throw e;
  }

  const ref = refDeAnticipo(depositId);
  const vuelta = `${base}/pago/anticipo`;
  try {
    const pref = await d.crearPreferencia(cred.accessToken, {
      items: [{ title: `Anticipo de factura ${inv.invoiceNumber}`.slice(0, 250), quantity: 1, unit_price: monto }],
      externalReference: ref,
      notificationUrl: `${base}/api/webhooks/mercadopago?ref=${encodeURIComponent(ref)}`,
      backUrls: { success: vuelta, failure: vuelta, pending: vuelta },
      marketplaceFee: comision,
      expiresAt: vence,
      binaryMode: true,
      excludedPaymentTypes: ["ticket", "atm"],
    });
    await d.db.appointmentDeposit.update({
      where: { id: depositId },
      data: { mpPreferenceId: pref.id, checkoutUrl: pref.initPoint },
    });
    return listo(
      {
        id: depositId,
        invoiceId: inv.id,
        amount: monto,
        expiresAt: vence.toISOString(),
        checkoutUrl: pref.initPoint,
        apartada: !!apartadaAppointment,
      },
      false,
    );
  } catch (e) {
    console.error(`[anticipos-panel] no se pudo crear el link de Mercado Pago (factura ${invoiceId}): ${(e as Error).message}`);
    await deshacerPedido(d, clinicId, depositId, apartadaAppointment?.id ?? null);
    return fallo("mp_fallo", "Mercado Pago no pudo generar el link. Intenta de nuevo en unos minutos.");
  }
}

async function deshacerPedido(
  d: DepsAnticipoPanel,
  clinicId: string,
  depositId: string,
  appointmentId: string | null,
): Promise<void> {
  try {
    await d.db.appointmentDeposit.updateMany({ where: { id: depositId, status: "PENDING" }, data: { status: "FAILED" } });
    if (appointmentId) {
      // Solo quita EL APARTADO que pusimos nosotros: la cita ya existía antes
      // de pedir el anticipo (a diferencia del bot, que la crea junto con él),
      // así que aquí nunca se cancela — solo deja de estar "apartada".
      await d.db.appointment.updateMany({ where: { id: appointmentId, clinicId, status: "SCHEDULED" }, data: { holdExpiresAt: null } });
    }
  } catch (e) {
    console.error(`[anticipos-panel] no se pudo deshacer el pedido ${depositId}:`, (e as Error).message);
  }
}

export interface ConceptoManual {
  /** Del catálogo de la clínica: gana sobre description/unitPrice si viene. */
  serviceId?: string;
  description?: string;
  unitPrice?: number;
}

/**
 * Pide el anticipo desde una CITA. Si la cita ya tiene factura, es exactamente
 * `pedirAnticipoDeFactura`. Si no, primero la crea (un concepto del catálogo o
 * el que escriba recepción) por el MISMO camino que
 * POST /api/invoices/from-appointment (`crearFacturaDesdeCita`), y luego pide
 * el anticipo sobre ella.
 */
export async function pedirAnticipoDeCita(
  args: {
    clinicId: string;
    appointmentId: string;
    userId: string;
    monto: number;
    horas?: number;
    concepto?: ConceptoManual;
  },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  try {
    return await pedirAnticipoDeCitaImpl(args, over);
  } catch (e) {
    if (faltaTabla(e)) return fallo("sin_mp", "Falta aplicar la actualización de la base (sql/anticipo-desde-panel.sql).");
    throw e;
  }
}

async function pedirAnticipoDeCitaImpl(
  args: {
    clinicId: string;
    appointmentId: string;
    userId: string;
    monto: number;
    horas?: number;
    concepto?: ConceptoManual;
  },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  const d = deps(over);
  const appt = await d.db.appointment.findFirst({
    where: { id: args.appointmentId, clinicId: args.clinicId },
    select: { id: true, patientId: true },
  });
  if (!appt) return fallo("no_encontrada");

  const existente = await d.db.invoice.findUnique({ where: { appointmentId: appt.id }, select: { id: true } });
  let invoiceId = existente?.id ?? null;

  if (!invoiceId) {
    let description = args.concepto?.description?.trim() ?? "";
    let unitPrice = args.concepto?.unitPrice;
    if (args.concepto?.serviceId) {
      const servicio = await d.db.procedureCatalog.findFirst({
        where: { id: args.concepto.serviceId, clinicId: args.clinicId, isActive: true },
        select: { name: true, basePrice: true },
      });
      if (!servicio) return fallo("sin_concepto", "El servicio del catálogo no existe.");
      description = servicio.name;
      unitPrice = servicio.basePrice;
    }
    if (!description || typeof unitPrice !== "number" || !(unitPrice >= 0)) {
      return fallo("sin_concepto", "Esta cita no tiene factura: elige un servicio del catálogo o escribe un concepto y un precio.");
    }
    const creada = await crearFacturaDesdeCita({
      clinicId: args.clinicId,
      appointmentId: appt.id,
      patientId: appt.patientId,
      lineItems: [{ description, unitPrice, quantity: 1 }],
      userId: args.userId,
    });
    if (creada.ok && creada.invoice) {
      invoiceId = creada.invoice.id;
    } else if (creada.error === "invoice_already_exists" && creada.existente) {
      invoiceId = creada.existente.id;
    } else {
      return fallo("mp_fallo", "No se pudo crear la factura de la cita.");
    }
  }

  return pedirAnticipoDeFactura({ clinicId: args.clinicId, invoiceId, userId: args.userId, monto: args.monto, horas: args.horas }, over);
}

// ── 3. Cuando la factura cambia con un anticipo pendiente ──────────────────

/**
 * El precio de la factura cambió, se canceló o se saldó por otro lado con un
 * anticipo PENDING encima: ese link pedía un monto que ya no es (mismo motivo
 * que `cerrarLinksDeFactura` en factura-mp). Cierra la preferencia en Mercado
 * Pago, marca el anticipo EXPIRED y —si había apartado una cita— le quita
 * SOLO el apartado (la cita sigue viva; nunca se cancela desde aquí).
 *
 * NUNCA lanza: el cobro que llama a esto ya quedó. Sin el SQL de esta rama no
 * hay nada que cerrar.
 */
export async function cerrarAnticiposDePanel(
  args: { clinicId: string; invoiceId: string },
  over?: Partial<DepsAnticipoPanel>,
): Promise<number> {
  const d = deps(over);
  const { clinicId, invoiceId } = args;
  if (!clinicId || !invoiceId) return 0;
  try {
    const pendientes = await d.db.appointmentDeposit.updateMany({
      where: { clinicId, invoiceId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (pendientes.count === 0) return 0;
    const filas = await d.db.appointmentDeposit.findMany({
      where: { clinicId, invoiceId, status: "EXPIRED" },
      select: { id: true, mpPreferenceId: true, appointmentId: true },
      orderBy: { createdAt: "desc" },
      take: pendientes.count,
    });
    const cred = await d.credencial(clinicId);
    for (const f of filas) {
      if (cred && f.mpPreferenceId) {
        try {
          await d.expirarPreferencia(cred.accessToken, f.mpPreferenceId);
        } catch (e) {
          console.error(`[anticipos-panel] no se pudo cerrar la preferencia ${f.mpPreferenceId}: ${(e as Error).message}`);
        }
      }
      if (f.appointmentId) {
        await d.db.appointment.updateMany({
          where: { id: f.appointmentId, clinicId, status: "SCHEDULED" },
          data: { holdExpiresAt: null },
        });
      }
    }
    return pendientes.count;
  } catch (e) {
    if (!faltaTabla(e)) console.error(`[anticipos-panel] no se pudieron cerrar los anticipos de ${invoiceId}: ${(e as Error).message}`);
    return 0;
  }
}
