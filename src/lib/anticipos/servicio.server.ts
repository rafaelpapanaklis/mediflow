// Anticipo por WhatsApp con Mercado Pago (WS1-T5) — el servicio.
//
//   1. El paciente elige horario en el bot.
//   2. Si la clínica pide anticipo, la cita nace SCHEDULED y APARTADA
//      (`holdExpiresAt`), con su AppointmentDeposit PENDING, en una sola
//      escritura (`crearCitaDesdeBot`).
//   3. Se crea la preferencia de Mercado Pago EN LA CUENTA DE LA CLÍNICA y el
//      bot manda el link.
//   4. El paciente paga → webhook → `aplicarPagoDeAnticipo`: verifica el pago
//      contra MP, crea el PatientCredit (saldo a favor), confirma la cita.
//   5. El bot avisa (avisos.server.ts).
//   6. Si no paga a tiempo, el hueco ya está libre POR DATO (apartado.ts +
//      trigger). `liberarAnticiposVencidos` (cron) solo marca y avisa.
//
// Todo lo que toca base o red entra por `DepsAnticipos`, así las pruebas lo
// conducen con una base en memoria y un Mercado Pago de mentira.

import { prisma } from "@/lib/prisma";
import { createPreference, getPayment } from "@/lib/mercadopago";
import type { CreatePreferenceOptions, CreatePreferenceResult, MercadoPagoPayment } from "@/lib/mercadopago";
// Solo TIPOS de bot-booking-service: el módulo lleva `import "server-only"` y
// las pruebas (tsx, sin Next) morirían al cargarlo. El valor se carga perezoso
// en `depsReales`.
import type { createBotAppointment, CreateResult } from "@/lib/agenda/bot-booking-service";
import { MOTIVO_APARTADO_LIBERADO } from "@/lib/agenda/apartado";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import {
  MINUTOS_MIN,
  calcularComision,
  calcularMontoAnticipo,
  evaluarPago,
  refDeAnticipo,
  type ModoAnticipo,
  type ModoComision,
  type PoliticaAnticipo,
} from "./core";
import { credencialDeCobro, plataformaAnticipos, urlBaseApp, type CredencialDeCobro } from "./cuenta.server";

type Db = typeof prisma;

/** Qué le toca decir al bot después de que algo pasó con el dinero. */
export type AvisoAnticipo =
  | { tipo: "confirmada"; depositId: string; monto: number }
  | { tipo: "pagada_sin_cita"; depositId: string; monto: number }
  | { tipo: "liberada"; depositId: string };

export interface DepsAnticipos {
  db: Db;
  plataformaLista: () => boolean;
  credencial: (clinicId: string) => Promise<CredencialDeCobro | null>;
  consultarPago: (token: string, paymentId: string) => Promise<MercadoPagoPayment | null>;
  crearPreferencia: (token: string, opts: CreatePreferenceOptions) => Promise<CreatePreferenceResult>;
  crearCita: typeof createBotAppointment;
  avisar: (aviso: AvisoAnticipo) => Promise<void>;
  ahora: () => Date;
  baseUrl: () => string | null;
}

/**
 * Las dependencias de verdad. `crearCita` y `avisar` se cargan perezosos: uno
 * lleva `server-only` y el otro arrastra todo WhatsApp.
 */
export const depsReales: DepsAnticipos = {
  db: prisma,
  plataformaLista: () => plataformaAnticipos().lista,
  credencial: (clinicId) => credencialDeCobro(clinicId),
  consultarPago: (token, paymentId) => getPayment(token, paymentId, { throwOnAuthError: true }),
  crearPreferencia: createPreference,
  crearCita: async (params) => {
    const { createBotAppointment } = await import("@/lib/agenda/bot-booking-service");
    return createBotAppointment(params);
  },
  avisar: async (aviso) => {
    const { avisarAlPaciente } = await import("./avisos.server");
    await avisarAlPaciente(aviso);
  },
  ahora: () => new Date(),
  baseUrl: urlBaseApp,
};

function deps(over?: Partial<DepsAnticipos>): DepsAnticipos {
  return over ? { ...depsReales, ...over } : depsReales;
}

/** Tabla o columna que todavía no existe (el SQL va por detrás del deploy). */
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

// ── 1. La política vigente de la clínica ────────────────────────────────────

/**
 * La configuración del anticipo, SOLO si está encendida y hay cuenta conectada.
 * null = esta clínica no pide anticipo: el bot agenda exactamente como siempre.
 * El filtro por token NO lee el token: pregunta si existe.
 */
export async function leerPoliticaVigente(
  clinicId: string,
  over?: Partial<DepsAnticipos>,
): Promise<PoliticaAnticipo | null> {
  const d = deps(over);
  if (!clinicId || !d.plataformaLista()) return null;
  try {
    const fila = await d.db.clinicMercadoPago.findFirst({
      where: { clinicId, depositEnabled: true, accessToken: { not: null }, mpUserId: { not: null } },
      select: {
        depositMode: true,
        depositAmount: true,
        depositPercent: true,
        holdMinutes: true,
        marketplaceFeeMode: true,
        marketplaceFeeValue: true,
      },
    });
    if (!fila) return null;
    return {
      modo: fila.depositMode as ModoAnticipo,
      monto: fila.depositAmount,
      porcentaje: fila.depositPercent,
      minutos: fila.holdMinutes,
      comisionModo: fila.marketplaceFeeMode as ModoComision,
      comisionValor: fila.marketplaceFeeValue,
    };
  } catch (e) {
    if (faltaTabla(e)) return null;
    throw e;
  }
}

async function precioDelServicio(db: Db, clinicId: string, serviceId: string | null | undefined) {
  if (!serviceId) return null;
  const svc = await db.procedureCatalog.findFirst({
    where: { id: serviceId, clinicId, isActive: true },
    select: { basePrice: true },
  });
  return svc?.basePrice ?? null;
}

/**
 * Lo que el bot anuncia ANTES del «¿confirmas?»: cuánto y cuánto tiempo. Es
 * solo el aviso; el monto que se cobra se vuelve a calcular al crear el link.
 */
export async function anticipoParaAnunciar(
  clinicId: string,
  serviceId: string | null | undefined,
  over?: Partial<DepsAnticipos>,
): Promise<{ monto: number; minutos: number } | null> {
  const d = deps(over);
  const politica = await leerPoliticaVigente(clinicId, d);
  if (!politica) return null;
  const monto = calcularMontoAnticipo(politica, await precioDelServicio(d.db, clinicId, serviceId));
  return monto === null ? null : { monto, minutos: politica.minutos };
}

// ── 2 y 3. La cita apartada y su link ───────────────────────────────────────

export interface CrearCitaBotParams {
  clinicId: string;
  patientId: string;
  doctorId: string;
  dateISO: string;
  time: string;
  durationMin: number;
  reason?: string | null;
  serviceId?: string | null;
  threadId?: string | null;
}

/**
 * Lo que el bot llama al «sí». Si la clínica no pide anticipo, es EXACTAMENTE
 * `createBotAppointment` de siempre. Si lo pide:
 *   · el monto lo calcula el servidor con la política y el precio del catálogo;
 *   · la cita nace apartada y su anticipo PENDING nace con ella (una escritura);
 *   · se crea la preferencia en la cuenta de la clínica, con caducidad igual al
 *     plazo, sin OXXO ni efectivo (tardan horas) y en modo binario (solo
 *     aprobado o rechazado);
 *   · si el link no sale, se deshace el apartado: la cita no queda tomada por
 *     un pago que nadie puede hacer.
 */
export async function crearCitaDesdeBot(
  params: CrearCitaBotParams,
  over?: Partial<DepsAnticipos>,
): Promise<CreateResult> {
  const d = deps(over);
  const { serviceId, threadId, ...cita } = params;

  const politica = await leerPoliticaVigente(params.clinicId, d);
  if (!politica) return d.crearCita(cita);

  const monto = calcularMontoAnticipo(politica, await precioDelServicio(d.db, params.clinicId, serviceId));
  if (monto === null) return d.crearCita(cita); // por debajo del mínimo: sin anticipo

  const comision = calcularComision(politica.comisionModo, politica.comisionValor, monto);
  if (comision === null) {
    console.error(
      `[anticipos] la comisión configurada se come el anticipo de $${monto} (clínica ${params.clinicId}); no se genera link`,
    );
    return { ok: false, error: "pago_no_disponible" };
  }

  const base = d.baseUrl();
  const cred = await d.credencial(params.clinicId);
  if (!cred || !base) return { ok: false, error: "pago_no_disponible" };

  const waPhone = threadId
    ? (
        await d.db.inboxThread.findFirst({
          where: { id: threadId, clinicId: params.clinicId },
          select: { externalId: true },
        })
      )?.externalId ?? null
    : null;

  const clinica = await d.db.clinic.findUnique({
    where: { id: params.clinicId },
    select: { name: true, timezone: true },
  });

  // El plazo nunca pasa del inicio de la cita: un link vivo con la cita ya
  // empezada no aparta nada. Si para pagar quedan menos de MINUTOS_MIN (cita
  // para dentro de un rato), se agenda SIN anticipo, como siempre: entra a la
  // cola de validación del equipo igual que cualquier cita del bot.
  const ahora = d.ahora();
  const [hh, mm] = params.time.split(":").map(Number);
  const inicio = tzLocalToUtc(params.dateISO, hh, mm, clinica?.timezone ?? "America/Mexico_City");
  const venceMs = Math.min(ahora.getTime() + politica.minutos * 60_000, inicio.getTime());
  if (!Number.isFinite(venceMs) || venceMs - ahora.getTime() < MINUTOS_MIN * 60_000) {
    return d.crearCita(cita);
  }
  const vence = new Date(venceMs);
  const minutos = Math.round((venceMs - ahora.getTime()) / 60_000);

  const creada = await d.crearCita({
    ...cita,
    apartado: {
      vence,
      anticipo: { amount: monto, marketplaceFee: comision, mpCollectorId: cred.mpUserId, waPhone },
    },
  });
  if (!creada.ok || !creada.appointmentId) return creada;
  if (!creada.depositId) {
    // No debería pasar: la cita apartada nace con su anticipo.
    await deshacerApartado(d, params.clinicId, creada.appointmentId, null);
    return { ok: false, error: "pago_no_disponible" };
  }

  const ref = refDeAnticipo(creada.depositId);
  const vuelta = `${base}/pago/anticipo`;
  try {
    const pref = await d.crearPreferencia(cred.accessToken, {
      items: [
        {
          title: `Anticipo de cita — ${clinica?.name ?? "consultorio"}`.slice(0, 250),
          quantity: 1,
          unit_price: monto,
        },
      ],
      externalReference: ref,
      notificationUrl: `${base}/api/webhooks/mercadopago?ref=${encodeURIComponent(ref)}`,
      backUrls: { success: vuelta, failure: vuelta, pending: vuelta },
      marketplaceFee: comision,
      expiresAt: vence,
      binaryMode: true,
      excludedPaymentTypes: ["ticket", "atm"],
    });
    await d.db.appointmentDeposit.update({
      where: { id: creada.depositId },
      data: { mpPreferenceId: pref.id, checkoutUrl: pref.initPoint },
    });
    return {
      ...creada,
      anticipo: { url: pref.initPoint, monto, venceA: vence.toISOString(), minutos },
    };
  } catch (e) {
    console.error(
      `[anticipos] no se pudo crear el link de Mercado Pago (clínica ${params.clinicId}): ${(e as Error).message}`,
    );
    await deshacerApartado(d, params.clinicId, creada.appointmentId, creada.depositId);
    return { ok: false, error: "pago_no_disponible" };
  }
}

async function deshacerApartado(
  d: DepsAnticipos,
  clinicId: string,
  appointmentId: string,
  depositId: string | null,
): Promise<void> {
  try {
    await d.db.appointment.updateMany({
      where: { id: appointmentId, clinicId, status: "SCHEDULED" },
      data: {
        status: "CANCELLED",
        cancelledAt: d.ahora(),
        cancelReason: "No se pudo generar el link de pago del anticipo",
      },
    });
    if (depositId) {
      await d.db.appointmentDeposit.updateMany({
        where: { id: depositId, status: "PENDING" },
        data: { status: "FAILED" },
      });
    }
  } catch (e) {
    // El apartado caduca solo igual: el hueco no se queda tomado para siempre.
    console.error(`[anticipos] no se pudo deshacer el apartado ${appointmentId}:`, (e as Error).message);
  }
}

// ── 4 y 5. El webhook ───────────────────────────────────────────────────────

export type ResultadoPago =
  | { aplicado: false; motivo: string }
  | { aplicado: true; depositId: string; monto: number; confirmada: boolean; anomalia: string | null };

/** Lo que MP reporta cuando un pago que ya entró se revierte. */
const ESTADOS_DE_REVERSO = ["refunded", "charged_back", "cancelled", "in_mediation"];

/** Estados en los que la cita ya NO está apartada pero sigue viva (la recepción la movió a mano). */
const ESTADOS_VIVOS_SIN_APARTADO = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"];

function fechaCorta(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/**
 * Aplica un pago de Mercado Pago a un anticipo. Idempotente: MP reintenta y el
 * mismo pago puede llegar N veces; solo la primera crea el saldo a favor.
 *
 * Contrato con el webhook (mismo que el resto de ramas de MP):
 *   · Devuelve (→ 200) en todo lo DETERMINISTA: anticipo inexistente, pago que
 *     MP no encuentra, pago de otro anticipo, no aprobado, duplicado.
 *   · LANZA (→ 500, MP reintenta) en lo TRANSITORIO: red o 5xx de MP, token que
 *     MP rechaza, base caída, o la clínica sin cuenta (no se puede verificar un
 *     pago que puede ser real: si la reconecta, el reintento lo aplica).
 *
 * Seguridad: nada del cuerpo del webhook se cree. Solo se usa el id del pago
 * para PREGUNTARLE a Mercado Pago —con el token de la clínica— qué pasó.
 */
export async function aplicarPagoDeAnticipo(
  depositId: string,
  paymentId: string,
  over?: Partial<DepsAnticipos>,
): Promise<ResultadoPago> {
  const d = deps(over);
  if (!depositId || !paymentId) return { aplicado: false, motivo: "faltan datos" };

  const anticipo = await d.db.appointmentDeposit.findUnique({
    where: { id: depositId },
    select: { id: true, clinicId: true, amount: true, status: true, mpCollectorId: true },
  });
  if (!anticipo) return { aplicado: false, motivo: "anticipo inexistente" };

  const cred = await d.credencial(anticipo.clinicId);
  if (!cred) {
    console.error(
      `[anticipos] pago ${paymentId} del anticipo ${depositId}: la clínica no tiene cuenta de MP conectada; MP reintentará`,
    );
    throw new Error("clínica sin cuenta de Mercado Pago para verificar el pago");
  }
  if (anticipo.mpCollectorId && cred.mpUserId !== anticipo.mpCollectorId) {
    // Cambió de cuenta después de mandar el link: con el token nuevo el pago no
    // se ve. Se anota en la fila (la pantalla lo enseña con su número) y se
    // LANZA: Mercado Pago reintenta, y si la clínica vuelve a conectar la
    // cuenta original, el reintento lo aplica. Tragarlo con un 200 lo perdería.
    if (anticipo.status === "PENDING" || anticipo.status === "EXPIRED") {
      await d.db.appointmentDeposit.updateMany({
        where: { id: depositId },
        data: { lastMpStatus: "otra_cuenta", lastMpStatusDetail: `pago ${paymentId}` },
      });
    }
    console.error(
      `[anticipos] pago ${paymentId} del anticipo ${depositId}: la clínica conectó OTRA cuenta de MP; MP reintentará`,
    );
    throw new Error("la clínica conectó otra cuenta de Mercado Pago: el pago no se puede verificar");
  }

  const pago = await d.consultarPago(cred.accessToken, paymentId);
  if (!pago) return { aplicado: false, motivo: "Mercado Pago no encuentra el pago" };

  const primera = evaluarPago(anticipo, pago);
  if (primera.accion === "ignorar") {
    console.error(`[anticipos] pago ${paymentId} ignorado para ${depositId}: ${primera.motivo}`);
    return { aplicado: false, motivo: primera.motivo };
  }
  if (primera.accion === "anotar_estado") {
    // Rechazado, en proceso…: NO confirma. Se anota para el día que el paciente
    // diga «yo pagué»; puede reintentar con el mismo link mientras no venza.
    await d.db.appointmentDeposit.updateMany({
      where: { id: depositId, status: "PENDING" },
      data: { lastMpStatus: primera.estado, lastMpStatusDetail: primera.detalle },
    });
    // Un pago YA aplicado que MP ahora reporta devuelto o contracargado: el
    // saldo a favor no se toca solo (mover dinero a ciegas es peor), pero queda
    // marcado en su rastro para que la clínica lo revise y no se devuelva dos veces.
    if (ESTADOS_DE_REVERSO.includes(primera.estado)) {
      const rastro = await d.db.appointmentDepositPayment.findUnique({
        where: { mpPaymentId: pago.id },
        select: { id: true, depositId: true, anomaly: true },
      });
      if (rastro && rastro.depositId === depositId) {
        const nota = `Mercado Pago reporta este pago como «${primera.estado}»: el saldo a favor NO se descontó solo, revisarlo.`;
        if (!(rastro.anomaly ?? "").includes(nota)) {
          await d.db.appointmentDepositPayment.update({
            where: { id: rastro.id },
            data: { anomaly: rastro.anomaly ? `${rastro.anomaly} · ${nota}` : nota },
          });
          console.error(`[anticipos] pago ${pago.id} (${depositId}) reportado como ${primera.estado}: revisar saldo a favor`);
        }
      }
    }
    return { aplicado: false, motivo: `pago ${primera.estado}` };
  }

  const ahora = d.ahora();
  let resultado: ResultadoPago;
  try {
    resultado = await d.db.$transaction(async (tx) => {
      // Candado de la fila: dos entregas simultáneas del mismo pago (o dos pagos
      // del mismo link) se aplican de una en una.
      await tx.$queryRaw`SELECT id FROM appointment_deposits WHERE id = ${depositId} FOR UPDATE`;

      const ya = await tx.appointmentDepositPayment.findUnique({
        where: { mpPaymentId: pago.id },
        select: { id: true },
      });
      if (ya) return { aplicado: false as const, motivo: "pago ya aplicado" };

      // Se relee bajo el candado: otro pago pudo saldarlo mientras esperábamos.
      const fresco = await tx.appointmentDeposit.findUnique({
        where: { id: depositId },
        select: {
          id: true,
          clinicId: true,
          patientId: true,
          appointmentId: true,
          amount: true,
          status: true,
          mpCollectorId: true,
          appointment: { select: { startsAt: true } },
          clinic: { select: { timezone: true } },
        },
      });
      if (!fresco) return { aplicado: false as const, motivo: "anticipo inexistente" };
      const decision = evaluarPago(fresco, pago);
      if (decision.accion !== "aplicar") return { aplicado: false as const, motivo: "sin aplicar" };

      const cuando = fresco.appointment
        ? ` de la cita del ${fechaCorta(fresco.appointment.startsAt, fresco.clinic?.timezone ?? "America/Mexico_City")}`
        : "";
      const credito = await tx.patientCredit.create({
        data: {
          clinicId: fresco.clinicId,
          patientId: fresco.patientId,
          amount: decision.monto,
          source: "anticipo_mercadopago",
          creditDate: ahora,
          description:
            `Anticipo${cuando}, pagado por WhatsApp con Mercado Pago (pago ${pago.id}). ` +
            `Se descuenta del tratamiento.` +
            (decision.anomalia ? ` ⚠️ ${decision.anomalia}` : ""),
        },
        select: { id: true },
      });
      await tx.appointmentDepositPayment.create({
        data: {
          clinicId: fresco.clinicId,
          depositId,
          mpPaymentId: pago.id,
          amount: decision.monto,
          currency: pago.currencyId ?? "MXN",
          dateApproved: pago.dateApproved ? new Date(pago.dateApproved) : null,
          payerEmail: pago.payerEmail,
          paymentMethodId: pago.paymentMethodId,
          patientCreditId: credito.id,
          anomaly: decision.anomalia,
        },
      });

      // Confirmar SOLO si la cita sigue apartada (SCHEDULED). Si el trigger o el
      // cron ya la liberaron, el dinero queda a favor y la cita no revive: ese
      // hueco pudo tomarlo otra persona. Si la recepción ya la había confirmado
      // a mano, sigue confirmada.
      //
      // «Al acreditarse queda confirmada la cita» (el cliente): sale también de
      // la cola «por validar» del bot. El pago es la validación; la cita sigue
      // en la agenda como cualquier otra y el equipo la ve.
      let confirmada = false;
      if (decision.confirmar && fresco.appointmentId) {
        const hecho = await tx.appointment.updateMany({
          where: { id: fresco.appointmentId, clinicId: fresco.clinicId, status: "SCHEDULED" },
          data: { status: "CONFIRMED", confirmedAt: ahora, holdExpiresAt: null, requiresValidation: false },
        });
        if (hecho.count === 1) {
          confirmada = true;
        } else {
          const cita = await tx.appointment.findFirst({
            where: { id: fresco.appointmentId, clinicId: fresco.clinicId },
            select: { status: true },
          });
          confirmada = !!cita && ESTADOS_VIVOS_SIN_APARTADO.includes(cita.status);
        }
      }

      if (decision.anomalia === null) {
        await tx.appointmentDeposit.update({
          where: { id: depositId },
          data: {
            status: "PAID",
            mpPaymentId: pago.id,
            paidAmount: decision.monto,
            paidAt: ahora,
            appointmentConfirmed: confirmada,
            lastMpStatus: pago.status,
            lastMpStatusDetail: pago.statusDetail,
          },
        });
      } else {
        console.error(`[anticipos] pago ${pago.id} aplicado con anomalía (${depositId}): ${decision.anomalia}`);
      }

      return {
        aplicado: true as const,
        depositId,
        monto: decision.monto,
        confirmada,
        anomalia: decision.anomalia,
      };
    });
  } catch (e) {
    // Dos entregas que se cruzaron sin candado: la segunda choca con el índice
    // único de mpPaymentId. No es un fallo: el pago ya está aplicado.
    if ((e as { code?: string })?.code === "P2002") return { aplicado: false, motivo: "pago ya aplicado" };
    throw e;
  }

  if (resultado.aplicado && resultado.anomalia === null) {
    // Fuera de la transacción y sin poder tumbar el webhook: el dinero ya quedó.
    await avisarSinRomper(
      d,
      resultado.confirmada
        ? { tipo: "confirmada", depositId, monto: resultado.monto }
        : { tipo: "pagada_sin_cita", depositId, monto: resultado.monto },
    );
  }
  return resultado;
}

async function avisarSinRomper(d: DepsAnticipos, aviso: AvisoAnticipo): Promise<void> {
  try {
    await d.avisar(aviso);
  } catch (e) {
    console.error(`[anticipos] aviso ${aviso.tipo} del anticipo ${aviso.depositId} falló:`, (e as Error).message);
  }
}

// ── 6. Los que vencieron ────────────────────────────────────────────────────

/**
 * Margen antes de dar por vencido un anticipo: un pago aprobado al filo del
 * plazo puede avisar por webhook unos segundos después. Mientras tanto el hueco
 * YA se ofrece a otros (la caducidad es por dato); esto solo retrasa el aviso.
 */
export const GRACIA_MS = 5 * 60_000;
const LOTE = 200;

export interface ResumenLimpieza {
  revisados: number;
  vencidos: number;
  liberadas: number;
  avisos: number;
  huerfanas: number;
}

/**
 * Lo que hace el cron. NO es lo que libera el hueco —eso ya pasó por dato en
 * el instante del vencimiento—; aquí se ordena la casa:
 *   · el anticipo PENDING vencido pasa a EXPIRED;
 *   · su cita, si sigue SCHEDULED y vencida, pasa a CANCELLED con el motivo;
 *   · si la cita quedó liberada (por aquí o por el trigger), el bot lo dice;
 *   · y cualquier cita apartada vencida sin anticipo pendiente se cancela.
 * Idempotente: dos corridas a la vez no avisan dos veces (claim por updateMany).
 */
export async function liberarAnticiposVencidos(over?: Partial<DepsAnticipos>): Promise<ResumenLimpieza> {
  const d = deps(over);
  const ahora = d.ahora();
  const corte = new Date(ahora.getTime() - GRACIA_MS);
  const resumen: ResumenLimpieza = { revisados: 0, vencidos: 0, liberadas: 0, avisos: 0, huerfanas: 0 };

  const pendientes = await d.db.appointmentDeposit.findMany({
    where: { status: "PENDING", expiresAt: { lte: corte } },
    select: { id: true, clinicId: true, appointmentId: true },
    orderBy: { expiresAt: "asc" },
    take: LOTE,
  });

  for (const dep of pendientes) {
    resumen.revisados++;
    const claim = await d.db.appointmentDeposit.updateMany({
      where: { id: dep.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (claim.count === 0) continue; // otra corrida, o el pago llegó justo ahora
    resumen.vencidos++;
    if (!dep.appointmentId) continue;

    await d.db.appointment.updateMany({
      where: {
        id: dep.appointmentId,
        clinicId: dep.clinicId,
        status: "SCHEDULED",
        holdExpiresAt: { lte: ahora },
      },
      data: { status: "CANCELLED", cancelledAt: ahora, cancelReason: MOTIVO_APARTADO_LIBERADO },
    });
    const cita = await d.db.appointment.findFirst({
      where: { id: dep.appointmentId, clinicId: dep.clinicId },
      select: { status: true, cancelReason: true, patientId: true, doctorId: true, startsAt: true },
    });
    // Solo se avisa si la liberó el vencimiento (aquí o el trigger). Si la
    // recepción la confirmó a mano o la canceló por otra razón, no hay nada que
    // decir.
    if (cita?.status === "CANCELLED" && cita.cancelReason === MOTIVO_APARTADO_LIBERADO) {
      resumen.liberadas++;
      // Y no si el MISMO paciente volvió a tomar ese hueco (se le venció y lo
      // pidió de nuevo): «se liberó tu horario» justo después de «confirmada»
      // solo confunde.
      const retomada = await d.db.appointment.findFirst({
        where: {
          clinicId: dep.clinicId,
          patientId: cita.patientId,
          doctorId: cita.doctorId,
          startsAt: cita.startsAt,
          id: { not: dep.appointmentId },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        select: { id: true },
      });
      if (!retomada) {
        await avisarSinRomper(d, { tipo: "liberada", depositId: dep.id });
        resumen.avisos++;
      }
    }
  }

  // Red de seguridad: cita apartada y vencida cuyo anticipo no está PENDING
  // (p. ej. el link falló y no se pudo deshacer). Solo limpia; no avisa. Nunca
  // toca una cita con anticipo PAGADO.
  const huerfanas = await d.db.appointment.updateMany({
    where: {
      status: "SCHEDULED",
      holdExpiresAt: { lte: corte },
      deposits: { none: { status: { in: ["PENDING", "PAID"] } } },
    },
    data: { status: "CANCELLED", cancelledAt: ahora, cancelReason: MOTIVO_APARTADO_LIBERADO },
  });
  resumen.huerfanas = huerfanas.count;
  return resumen;
}

/** Para el log del cron: el monto no es un secreto, el token sí. */
export function describirResumen(r: ResumenLimpieza): string {
  return `revisados=${r.revisados} vencidos=${r.vencidos} liberadas=${r.liberadas} avisos=${r.avisos} huerfanas=${r.huerfanas}`;
}
