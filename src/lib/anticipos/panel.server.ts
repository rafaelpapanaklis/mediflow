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
  citaEsFuturaParaAnticipo,
  metodoRegistroADeposito,
  redondear2,
  refDeAnticipo,
  sugeridoAnticipoPanel,
  validarMontoAnticipoManual,
  validarPlazoPanelHoras,
  validarReferenciaRegistro,
  type MetodoPedirAnticipo,
  type MetodoRegistroAnticipo,
  type ModoAnticipoPanel,
  type PoliticaAnticipoPanel,
} from "./core";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { leerDatosBancarios, type CuentaBancariaSede } from "./datos-bancarios.server";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { computeInvoiceTotal, clinicInvoiceTaxDefaults } from "@/lib/invoice-totals";
import { facturaOcupaLaCita } from "@/lib/invoices/cita-factura-cancelada";

type Db = typeof prisma;

export interface DepsAnticipoPanel {
  db: Db;
  plataformaLista: () => boolean;
  credencial: (clinicId: string) => Promise<CredencialDeCobro | null>;
  crearPreferencia: (token: string, opts: CreatePreferenceOptions) => Promise<CreatePreferenceResult>;
  expirarPreferencia: (token: string, preferenceId: string) => Promise<void>;
  ahora: () => Date;
  baseUrl: () => string | null;
  /** ws1-t3 fase 2 — datos bancarios de la sede, para «Pedir anticipo → Transferencia». */
  datosBancarios: (clinicId: string) => Promise<CuentaBancariaSede | null>;
}

export const depsReales: DepsAnticipoPanel = {
  db: prisma,
  plataformaLista: () => plataformaAnticipos().lista,
  credencial: (clinicId) => credencialDeCobro(clinicId),
  crearPreferencia: createPreference,
  expirarPreferencia: (token, id) => expirePreference(token, id),
  ahora: () => new Date(),
  baseUrl: urlBaseApp,
  datosBancarios: (clinicId) => leerDatosBancarios(clinicId),
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

export interface CanalesAnticipoPanel {
  /** Cuenta de Mercado Pago de la clínica conectada. */
  mercadopago: boolean;
  /** Datos bancarios de la sede cargados y con CLABE válida (fase 2). */
  transferencia: boolean;
}

/**
 * Qué canales puede ofrecer «Pedir anticipo» en esta clínica. Los dos son
 * INDEPENDIENTES a propósito (fase 2): una clínica sin cuenta de Mercado Pago
 * puede seguir pidiendo anticipos por transferencia con solo cargar sus datos
 * bancarios, y viceversa.
 */
export async function canalesAnticipoPanel(clinicId: string, over?: Partial<DepsAnticipoPanel>): Promise<CanalesAnticipoPanel> {
  const d = deps(over);
  if (!clinicId) return { mercadopago: false, transferencia: false };
  const [mercadopago, transferencia] = await Promise.all([
    (async () => {
      if (!d.plataformaLista() || !d.baseUrl()) return false;
      try {
        return !!(await d.credencial(clinicId));
      } catch {
        return false;
      }
    })(),
    (async () => {
      try {
        return !!(await d.datosBancarios(clinicId));
      } catch {
        return false;
      }
    })(),
  ]);
  return { mercadopago, transferencia };
}

/** El monto sugerido para prefijar el modal, dado el total de la factura. */
export async function sugeridoParaFactura(
  clinicId: string,
  totalFactura: number,
  over?: Partial<DepsAnticipoPanel>,
  /** Lo ya pagado de la factura: el sugerido se calcula sobre el saldo (H13). */
  pagado: number = 0,
): Promise<{ monto: number | null; horas: number }> {
  const politica = await leerPoliticaPanelVigente(clinicId, over);
  return { monto: sugeridoAnticipoPanel(politica, totalFactura, pagado), horas: politica.horas };
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
        select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true, method: true },
      }),
      d.db.appointmentDeposit.findMany({
        where: { clinicId, invoiceId, status: "PAID" },
        select: { paidAmount: true },
      }),
    ]);
    return {
      // Una transferencia PENDING nunca trae checkoutUrl (no hay link que
      // generar): "hay un pendiente" se decide por el MÉTODO, no por el link.
      pendiente: pendiente && (pendiente.method === "transferencia" || pendiente.checkoutUrl)
        ? {
            id: pendiente.id,
            invoiceId,
            amount: redondear2(pendiente.amount),
            expiresAt: pendiente.expiresAt.toISOString(),
            checkoutUrl: pendiente.checkoutUrl,
            apartada: !!pendiente.appointmentId,
            metodo: pendiente.method === "transferencia" ? "transferencia" : "mercadopago",
          }
        : null,
      anticipoPagado: pagados.reduce((acc: number, p: { paidAmount: number | null }) => acc + (p.paidAmount ?? 0), 0),
    };
  } catch (e) {
    if (faltaTabla(e)) return vacio;
    throw e;
  }
}

export interface ElegibilidadCita {
  elegible: boolean;
  /** null = elegible (o sin cita ligada). */
  motivo: string | null;
}

const MOTIVO_CITA_NO_FUTURA =
  "Esta factura está ligada a una cita que ya pasó, ya se atendió o ya no está viva: el anticipo solo se puede pedir para citas futuras.";

/**
 * Ajuste 2 (decisión de Rafael): si la factura no tiene cita, siempre
 * elegible. Si la tiene, SOLO si es futura (`citaEsFuturaParaAnticipo`) — el
 * mismo criterio exacto que aplica `pedirAnticipoDeFactura` al pedirlo de
 * verdad, para que el GET nunca prometa un botón que el POST va a rechazar.
 */
export async function elegibilidadCitaDeInvoice(
  clinicId: string,
  appointmentId: string | null,
  over?: Partial<DepsAnticipoPanel>,
): Promise<ElegibilidadCita> {
  const d = deps(over);
  if (!appointmentId) return { elegible: true, motivo: null };
  try {
    const appt = await d.db.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { status: true, startsAt: true },
    });
    if (!appt || !citaEsFuturaParaAnticipo(appt, d.ahora())) {
      return { elegible: false, motivo: MOTIVO_CITA_NO_FUTURA };
    }
    return { elegible: true, motivo: null };
  } catch (e) {
    if (faltaTabla(e)) return { elegible: true, motivo: null };
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
  | "cita_no_futura"
  | "mp_fallo";

export interface AnticipoPedido {
  id: string;
  invoiceId: string;
  amount: number;
  expiresAt: string;
  /** null = transferencia (fase 2): no hay link, solo texto + PDF con los datos bancarios. */
  checkoutUrl: string | null;
  /** true = además dejó la cita apartada (holdExpiresAt) para ese doctor y sillón. */
  apartada: boolean;
  /** Cómo se pidió: "mercadopago" (fase 1) o "transferencia" (fase 2). */
  metodo: MetodoPedirAnticipo;
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
  args: { clinicId: string; invoiceId: string; userId: string; monto: number; horas?: number; metodo?: MetodoPedirAnticipo },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  try {
    return await pedirAnticipoDeFacturaImpl(args, over);
  } catch (e) {
    if (faltaTabla(e)) return fallo("sin_mp", "Falta aplicar la actualización de la base (sql/anticipo-desde-panel.sql).");
    throw e;
  }
}

/**
 * UN SOLO TIPO, sin unión (mismo criterio que ResultadoPedirAnticipo: el
 * repo no compila en `strict` y no estrecha bien por un booleano `ok`).
 * `fallo` es null exactamente cuando el canal quedó resuelto.
 */
interface ResolverCanalResultado {
  cred: CredencialDeCobro | null;
  base: string | null;
  banco: CuentaBancariaSede | null;
  fallo: ResultadoPedirAnticipo | null;
}

/**
 * Valida el canal (Mercado Pago o transferencia) SIN tocar ninguna factura.
 * `pedirAnticipoDeFacturaImpl` la usa para la factura ya existente;
 * `pedirAnticipoDeCitaImpl` la llama ANTES de crear la factura de la cita
 * (N3, QA ronda 4): antes esto solo se comprobaba aquí dentro, así que una
 * cita SIN factura con el canal roto (sin MP conectado, o desconectado entre
 * abrir el modal y pedirlo) igual dejaba la factura creada — el 409 llegaba
 * después de `crearFacturaDesdeCita`, no antes.
 */
async function resolverCanal(
  d: DepsAnticipoPanel,
  clinicId: string,
  metodo: MetodoPedirAnticipo,
): Promise<ResolverCanalResultado> {
  if (metodo === "mercadopago") {
    if (!d.plataformaLista()) return { cred: null, base: null, banco: null, fallo: fallo("sin_mp") };
    const base = d.baseUrl();
    const cred = await d.credencial(clinicId);
    if (!cred || !base) return { cred: null, base: null, banco: null, fallo: fallo("sin_mp") };
    return { cred, base, banco: null, fallo: null };
  }
  const banco = await d.datosBancarios(clinicId);
  if (!banco) {
    return {
      cred: null,
      base: null,
      banco: null,
      fallo: fallo("sin_mp", "Esta clínica no tiene datos bancarios cargados: agrégalos en Configuración → Anticipos."),
    };
  }
  return { cred: null, base: null, banco, fallo: null };
}

async function pedirAnticipoDeFacturaImpl(
  args: { clinicId: string; invoiceId: string; userId: string; monto: number; horas?: number; metodo?: MetodoPedirAnticipo },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  const d = deps(over);
  const { clinicId, invoiceId, userId } = args;
  const metodo: MetodoPedirAnticipo = args.metodo === "transferencia" ? "transferencia" : "mercadopago";
  if (!clinicId || !invoiceId || !userId) return fallo("no_encontrada");

  // Los dos canales son INDEPENDIENTES (fase 2): Mercado Pago exige cuenta
  // conectada; transferencia exige datos bancarios de la sede cargados. Cada
  // uno se valida SOLO con lo que va a usar.
  const canal = await resolverCanal(d, clinicId, metodo);
  if (canal.fallo) return canal.fallo;
  const { cred, base, banco } = canal;
  const ahora = d.ahora();

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

  // Ajuste 2 (decisión de Rafael): si la factura está ligada a una cita, el
  // anticipo SOLO se puede pedir si esa cita sigue siendo futura (SCHEDULED/
  // CONFIRMED, con inicio después de ahora). Una factura sin cita (o cuya
  // cita ya pasó/se atendió) no ofrece «Pedir anticipo» por este camino —
  // el apartado no significa nada para algo que ya ocurrió.
  if (inv.appointmentId) {
    const citaLigada = await d.db.appointment.findFirst({
      where: { id: inv.appointmentId, clinicId },
      select: { status: true, startsAt: true },
    });
    if (!citaLigada || !citaEsFuturaParaAnticipo(citaLigada, ahora)) {
      return fallo(
        "cita_no_futura",
        "Esta factura está ligada a una cita que ya pasó, ya se atendió o ya no está viva: el anticipo solo se puede pedir para citas futuras.",
      );
    }
  }

  // Ya hay uno pendiente: se devuelve el mismo (nunca dos a la vez — lo
  // refuerza el índice único parcial de la base), SEA CUAL SEA el canal con
  // el que se pidió antes. Una transferencia pendiente no tiene checkoutUrl
  // (nunca lo tuvo — no hay link que generar), así que "ya está listo" se
  // decide por el MÉTODO, no por si trae link.
  const existente = await d.db.appointmentDeposit.findFirst({
    where: { invoiceId, clinicId, status: "PENDING" },
    select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true, method: true },
  });
  if (existente && (existente.method === "transferencia" || existente.checkoutUrl)) {
    return listo(
      {
        id: existente.id,
        invoiceId,
        amount: redondear2(existente.amount),
        expiresAt: existente.expiresAt.toISOString(),
        checkoutUrl: existente.checkoutUrl,
        apartada: !!existente.appointmentId,
        metodo: existente.method === "transferencia" ? "transferencia" : "mercadopago",
      },
      true,
    );
  }

  const errorMonto = validarMontoAnticipoManual(args.monto, inv.total, inv.paid);
  if (errorMonto) return fallo("monto_invalido", errorMonto);
  const monto = redondear2(args.monto);

  const cuentaFila = await d.db.clinicMercadoPago.findUnique({
    where: { clinicId },
    select: { panelDepositExpiryHours: true },
  });
  const horas = args.horas ?? cuentaFila?.panelDepositExpiryHours ?? PANEL_HORAS_DEFAULT;
  const errorHoras = validarPlazoPanelHoras(horas);
  if (errorHoras) return fallo("plazo_invalido", errorHoras);

  // Ajuste 2 (decisión de Rafael): los anticipos pedidos DESDE EL PANEL NUNCA
  // cobran comisión de DaleControl — a diferencia del anticipo del bot, que sí
  // usa marketplaceFeeMode/marketplaceFeeValue de ClinicMercadoPago. Es una
  // decisión de negocio explícita, no un descuido: el marketplace_fee que se
  // manda a Mercado Pago es SIEMPRE 0 en este camino.
  const comision = 0;

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
          mpCollectorId: metodo === "mercadopago" ? cred!.mpUserId : null,
          origin: "panel",
          method: metodo,
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
        select: { id: true, amount: true, expiresAt: true, checkoutUrl: true, appointmentId: true, method: true },
      });
      if (otro && (otro.method === "transferencia" || otro.checkoutUrl)) {
        return listo(
          {
            id: otro.id,
            invoiceId,
            amount: redondear2(otro.amount),
            expiresAt: otro.expiresAt.toISOString(),
            checkoutUrl: otro.checkoutUrl,
            apartada: !!otro.appointmentId,
            metodo: otro.method === "transferencia" ? "transferencia" : "mercadopago",
          },
          true,
        );
      }
    }
    throw e;
  }

  // Transferencia (fase 2): no hay link que generar — el depósito PENDING ya
  // es el "pedido" completo. El texto y el PDF con los datos bancarios los
  // arma la ruta (necesita nombre del paciente, cita humanizada…), no este
  // servicio: aquí solo vive el dinero.
  if (metodo === "transferencia") {
    return listo(
      { id: depositId, invoiceId: inv.id, amount: monto, expiresAt: vence.toISOString(), checkoutUrl: null, apartada: !!apartadaAppointment, metodo },
      false,
    );
  }

  const ref = refDeAnticipo(depositId);
  const vuelta = `${base}/pago/anticipo`;
  try {
    const pref = await d.crearPreferencia(cred!.accessToken, {
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
        metodo: "mercadopago",
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
    metodo?: MetodoPedirAnticipo;
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
    metodo?: MetodoPedirAnticipo;
  },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoPedirAnticipo> {
  const d = deps(over);
  const appt = await d.db.appointment.findFirst({
    where: { id: args.appointmentId, clinicId: args.clinicId },
    select: { id: true, patientId: true, status: true, startsAt: true },
  });
  if (!appt) return fallo("no_encontrada");

  // Ajuste 2 (decisión de Rafael): SOLO citas futuras. Se corta aquí, antes de
  // crear ninguna factura, para no armar una factura de la nada sobre una cita
  // que de todos modos no puede pedir anticipo.
  if (!citaEsFuturaParaAnticipo(appt, d.ahora())) {
    return fallo(
      "cita_no_futura",
      "Esta cita ya pasó, ya se atendió o ya no está viva: el anticipo solo se puede pedir para citas futuras.",
    );
  }

  // N3 (QA ronda 4): el canal se valida ANTES de crear la factura de la
  // cita — ver `resolverCanal`.
  const metodo: MetodoPedirAnticipo = args.metodo === "transferencia" ? "transferencia" : "mercadopago";
  const canal = await resolverCanal(d, args.clinicId, metodo);
  if (canal.fallo) return canal.fallo;

  const existente = await d.db.invoice.findUnique({ where: { appointmentId: appt.id }, select: { id: true, status: true } });
  // H1 (revisión final, ws1-t4): una factura CANCELADA no es la de la cita; se
  // pide sobre una nueva (crearFacturaDesdeCita suelta la cancelada).
  let invoiceId = facturaOcupaLaCita(existente) ? existente!.id : null;

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

    // Ajuste (ws1-t1, A2): el monto (y el plazo) se validan ANTES de crear la
    // factura de la cita — con el MISMO total que va a tener (misma
    // aritmética que crearFacturaDesdeCita: un solo concepto, sin descuento) —
    // para que un monto o un plazo inválidos no dejen una factura huérfana.
    // Antes esto se validaba solo dentro de pedirAnticipoDeFactura, que ya
    // corría con la factura recién creada.
    const clinicTax = await d.db.clinic.findUnique({ where: { id: args.clinicId }, select: { cfdiTaxMode: true } });
    const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinicTax?.cfdiTaxMode);
    const { total: totalPrevisto } = computeInvoiceTotal([{ quantity: 1, unitPrice }], 0, taxRate, taxIncluded);
    const errorMontoPrevio = validarMontoAnticipoManual(args.monto, totalPrevisto, 0);
    if (errorMontoPrevio) return fallo("monto_invalido", errorMontoPrevio);
    if (args.horas !== undefined) {
      const errorHorasPrevio = validarPlazoPanelHoras(args.horas);
      if (errorHorasPrevio) return fallo("plazo_invalido", errorHorasPrevio);
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

  return pedirAnticipoDeFactura(
    { clinicId: args.clinicId, invoiceId, userId: args.userId, monto: args.monto, horas: args.horas, metodo: args.metodo },
    over,
  );
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

// ── 4. «Registrar anticipo recibido» (ws1-t3 fase 2) ────────────────────────
//
// Efectivo, transferencia o terminal: recepción YA TIENE el dinero (lo ve en
// caja o en el estado de cuenta) y lo registra a mano. A diferencia de «Pedir
// anticipo», aquí NO se genera ningún link ni se espera ningún webhook — el
// Payment se crea en el instante, con su MÉTODO REAL (alimenta arqueo y CFDI,
// nunca "anticipo": ese método lo reserva la aplicación del saldo a favor del
// bot). Si ya había un anticipo PENDING de "Pedir anticipo → Transferencia"
// para esta factura, ESE se marca PAID; si no, se crea uno directo ya PAID.

export type ErrorRegistrarAnticipo = "no_encontrada" | "estado" | "sin_saldo" | "monto_invalido" | "metodo_invalido" | "referencia_requerida";

export interface AnticipoRegistrado {
  paymentId: string;
  depositId: string;
  invoiceId: string;
  amount: number;
  method: MetodoRegistroAnticipo;
  /** true = la cita quedó CONFIRMED y sin apartado. */
  citaConfirmada: boolean;
  /** El dinero SIEMPRE se registra; esto solo dice que la cita no se pudo confirmar sola. */
  anomalia: string | null;
}

/** UN SOLO TIPO, sin unión (mismo criterio que ResultadoPedirAnticipo). */
export interface ResultadoRegistrarAnticipo {
  ok: boolean;
  error: ErrorRegistrarAnticipo | null;
  motivo: string | null;
  registrado: AnticipoRegistrado | null;
}

function falloRegistro(error: ErrorRegistrarAnticipo, motivo?: string): ResultadoRegistrarAnticipo {
  return { ok: false, error, motivo: motivo ?? null, registrado: null };
}

export async function registrarAnticipoRecibido(
  args: {
    clinicId: string;
    invoiceId: string;
    userId: string;
    monto: number;
    method: MetodoRegistroAnticipo;
    reference?: string;
    notes?: string;
  },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoRegistrarAnticipo> {
  try {
    return await registrarAnticipoRecibidoImpl(args, over);
  } catch (e) {
    if (faltaTabla(e)) return falloRegistro("no_encontrada", "Falta aplicar la actualización de la base (sql/anticipo-desde-panel.sql).");
    throw e;
  }
}

async function registrarAnticipoRecibidoImpl(
  args: {
    clinicId: string;
    invoiceId: string;
    userId: string;
    monto: number;
    method: MetodoRegistroAnticipo;
    reference?: string;
    notes?: string;
  },
  over?: Partial<DepsAnticipoPanel>,
): Promise<ResultadoRegistrarAnticipo> {
  const d = deps(over);
  const { clinicId, invoiceId, userId } = args;
  if (!clinicId || !invoiceId || !userId) return falloRegistro("no_encontrada");
  const errorRef = validarReferenciaRegistro(args.method, args.reference);
  if (errorRef) return falloRegistro("referencia_requerida", errorRef);

  const inv = await d.db.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    select: { id: true, status: true, total: true, paid: true, patientId: true, appointmentId: true },
  });
  if (!inv) return falloRegistro("no_encontrada");
  if (!ESTADOS_COBRABLES.includes(inv.status)) {
    return falloRegistro("estado", "Solo se puede registrar un anticipo sobre una factura emitida con saldo (pendiente, parcial o vencida).");
  }
  const saldo = redondear2(Math.max(0, inv.total - inv.paid));
  if (!(saldo > 0)) return falloRegistro("sin_saldo", "La factura ya no tiene saldo por cobrar.");
  const errorMonto = validarMontoAnticipoManual(args.monto, inv.total, inv.paid);
  if (errorMonto) return falloRegistro("monto_invalido", errorMonto);
  const monto = redondear2(args.monto);
  const ahora = d.ahora();
  const reference = args.reference?.trim() || null;
  const notes = args.notes?.trim() || null;
  const depositMethod = metodoRegistroADeposito(args.method);

  // Lectura + escritura en la MISMA transacción con lock de fila (FOR UPDATE),
  // igual que POST /api/invoices/[id] (el cobro manual de siempre): serializa
  // contra otro cobro o contra el webhook de un pago en línea, sin lost
  // updates de paid/balance.
  const resultado = await d.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const fresca = await tx.invoice.findFirst({ where: { id: invoiceId, clinicId }, select: { total: true, paid: true, status: true } });
    if (!fresca || !ESTADOS_COBRABLES.includes(fresca.status)) return { error: "estado" as const };
    const saldoFresco = redondear2(Math.max(0, fresca.total - fresca.paid));
    if (monto > saldoFresco + 0.01) return { error: "monto_invalido" as const };

    const pago = await tx.payment.create({
      data: { invoiceId, amount: monto, method: args.method, reference, notes, paidAt: ahora },
      select: { id: true },
    });
    const nuevoPagado = redondear2(fresca.paid + monto);
    const nuevoSaldo = redondear2(Math.max(0, fresca.total - nuevoPagado));
    const saldada = nuevoSaldo <= 0;
    await tx.invoice.updateMany({
      where: { id: invoiceId, clinicId },
      data: {
        paid: nuevoPagado,
        balance: nuevoSaldo,
        status: saldada ? "PAID" : "PARTIAL",
        paymentMethod: args.method,
        ...(saldada ? { paidAt: ahora } : {}),
      },
    });

    // Reusa el PENDING de esta factura si lo hay (nació de "Pedir anticipo →
    // Transferencia"); si no, recepción cobró sin pedirlo antes por este
    // camino y se crea uno directo ya PAID.
    const pendiente = await tx.appointmentDeposit.findFirst({
      where: { clinicId, invoiceId, status: "PENDING" },
      select: { id: true, appointmentId: true },
    });
    let depositId: string;
    let appointmentId: string | null;
    if (pendiente) {
      await tx.appointmentDeposit.update({
        where: { id: pendiente.id },
        data: { status: "PAID", method: depositMethod, paidAmount: monto, paidAt: ahora, paymentId: pago.id },
      });
      depositId = pendiente.id;
      appointmentId = pendiente.appointmentId;
    } else {
      const nuevo = await tx.appointmentDeposit.create({
        data: {
          clinicId,
          patientId: inv.patientId,
          appointmentId: inv.appointmentId ?? null,
          invoiceId,
          amount: monto,
          marketplaceFee: 0,
          currency: "MXN",
          status: "PAID",
          expiresAt: ahora,
          paidAmount: monto,
          paidAt: ahora,
          origin: "panel",
          method: depositMethod,
          createdById: userId,
          paymentId: pago.id,
        },
        select: { id: true },
      });
      depositId = nuevo.id;
      appointmentId = inv.appointmentId ?? null;
    }

    // Confirma la cita y quita el apartado — SOLO si sigue SCHEDULED (mismo
    // candado condicional que aplicarPagoDeAnticipo en servicio.server.ts):
    // si el hueco ya se perdió (lo tomó otra cita) o ya estaba confirmada por
    // otro medio, NO se confirma a ciegas. El dinero YA se registró arriba
    // pase lo que pase con la cita.
    let citaConfirmada = false;
    let anomalia: string | null = null;
    if (appointmentId) {
      const conf = await tx.appointment.updateMany({
        where: { id: appointmentId, clinicId, status: "SCHEDULED" },
        data: { status: "CONFIRMED", holdExpiresAt: null },
      });
      if (conf.count === 1) {
        citaConfirmada = true;
      } else {
        const actual = await tx.appointment.findFirst({ where: { id: appointmentId, clinicId }, select: { status: true } });
        if (actual && actual.status !== "CONFIRMED") {
          anomalia = `El anticipo se cobró, pero la cita ya no estaba disponible para confirmarla sola (estado: ${actual.status}). Revísala con el paciente.`;
        }
      }
    }
    if (anomalia) {
      await tx.payment.update({ where: { id: pago.id }, data: { notes: notes ? `${notes} · ⚠️ ${anomalia}` : `⚠️ ${anomalia}` } });
    }

    // ws1-t1 (M6): sin esto, `appointmentConfirmed` se quedaba en su default
    // (false) sin importar cómo salió la cita — «Últimos anticipos»
    // (pantalla.server.ts) lee esta columna, no la variable en memoria de
    // arriba, así que un anticipo confirmado por este camino aparecía igual
    // que uno que nunca lo logró.
    if (appointmentId) {
      await tx.appointmentDeposit.update({ where: { id: depositId }, data: { appointmentConfirmed: citaConfirmada } });
    }

    return { ok: true as const, paymentId: pago.id, depositId, citaConfirmada, anomalia };
  });

  if ("error" in resultado) {
    return resultado.error === "estado"
      ? falloRegistro("estado", "La factura cambió mientras registrabas el anticipo (se canceló o se saldó). Vuelve a abrirla.")
      : falloRegistro("monto_invalido", "El monto excede el saldo pendiente (cambió mientras registrabas el anticipo).");
  }

  // El saldo cambió: un link de Mercado Pago (factura completa) que pedía el
  // saldo viejo queda obsoleto. Nunca lanza.
  await cerrarLinksDeFactura({ clinicId, invoiceId }).catch(() => {});

  return {
    ok: true,
    error: null,
    motivo: null,
    registrado: {
      paymentId: resultado.paymentId,
      depositId: resultado.depositId,
      invoiceId,
      amount: monto,
      method: args.method,
      citaConfirmada: resultado.citaConfirmada,
      anomalia: resultado.anomalia,
    },
  };
}
