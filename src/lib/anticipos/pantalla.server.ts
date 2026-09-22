// Lo que la pantalla Configuración → Anticipos por WhatsApp puede ver (WS1-T5).
//
// Sin secretos: de la cuenta de Mercado Pago salen apodo, correo, el id
// enmascarado y fechas. Nunca el token, ni un trozo.

import { prisma } from "@/lib/prisma";
import { enmascarar, plataformaAnticipos, type EstadoCuentaMp, type PlataformaAnticipos } from "./cuenta.server";
import { MINUTOS_DEFAULT, type ModoAnticipo, type ModoComision } from "./core";

export interface AnticipoReciente {
  id: string;
  creado: string;
  paciente: string;
  /** Inicio de la cita (ISO) o null si la cita ya no existe. */
  cita: string | null;
  monto: number;
  estado: string;
  pagado: number | null;
  /** Id del pago en Mercado Pago: la referencia para el «yo pagué». */
  referenciaMp: string | null;
  citaConfirmada: boolean;
  ultimoEstadoMp: string | null;
  /** Detalle de MP (motivo de rechazo) o, con «otra_cuenta», el número del pago. */
  ultimoDetalleMp: string | null;
  avisoError: string | null;
  /** Pagos con algo raro (segundo pago, monto menor…) que alguien debe revisar. */
  anomalias: string[];
}

export interface PantallaAnticipos {
  /** false = el SQL (sql/anticipo-whatsapp.sql) todavía no está aplicado. */
  tablasListas: boolean;
  plataforma: PlataformaAnticipos;
  cuenta: EstadoCuentaMp;
  config: { activo: boolean; modo: ModoAnticipo; monto: number; porcentaje: number; minutos: number };
  /** Solo lectura para la clínica: la fija DaleControl. Arranca en 0. */
  comision: { modo: ModoComision; valor: number };
  recientes: AnticipoReciente[];
}

const SIN_CUENTA: EstadoCuentaMp = {
  conectada: false,
  apodo: null,
  correo: null,
  cuentaId: null,
  modoPruebas: false,
  conectadaEl: null,
  desconectadaEl: null,
};

function vacia(plataforma: PlataformaAnticipos, tablasListas: boolean): PantallaAnticipos {
  return {
    tablasListas,
    plataforma,
    cuenta: SIN_CUENTA,
    config: { activo: false, modo: "fixed", monto: 0, porcentaje: 0, minutos: MINUTOS_DEFAULT },
    comision: { modo: "fixed", valor: 0 },
    recientes: [],
  };
}

export async function leerPantallaAnticipos(clinicId: string): Promise<PantallaAnticipos> {
  const plataforma = plataformaAnticipos();
  if (!clinicId) return vacia(plataforma, true);

  try {
    const [fila, recientes] = await Promise.all([
      prisma.clinicMercadoPago.findUnique({
        where: { clinicId },
        select: {
          mpUserId: true,
          mpNickname: true,
          mpEmail: true,
          liveMode: true,
          connectedAt: true,
          disconnectedAt: true,
          depositEnabled: true,
          depositMode: true,
          depositAmount: true,
          depositPercent: true,
          holdMinutes: true,
          marketplaceFeeMode: true,
          marketplaceFeeValue: true,
          // ¿Hay token? Se pregunta por la fecha, no se lee el token.
          tokenExpiresAt: true,
        },
      }),
      prisma.appointmentDeposit.findMany({
        where: { clinicId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          amount: true,
          status: true,
          paidAmount: true,
          mpPaymentId: true,
          appointmentConfirmed: true,
          lastMpStatus: true,
          lastMpStatusDetail: true,
          noticeError: true,
          patient: { select: { firstName: true, lastName: true } },
          appointment: { select: { startsAt: true } },
          payments: { where: { anomaly: { not: null } }, select: { anomaly: true, mpPaymentId: true } },
        },
      }),
    ]);

    const conectada = !!fila?.mpUserId && !!fila.tokenExpiresAt && !fila.disconnectedAt;
    return {
      tablasListas: true,
      plataforma,
      cuenta: fila
        ? {
            conectada,
            apodo: fila.mpNickname,
            correo: fila.mpEmail,
            cuentaId: enmascarar(fila.mpUserId),
            modoPruebas: fila.liveMode === false,
            conectadaEl: fila.connectedAt?.toISOString() ?? null,
            desconectadaEl: fila.disconnectedAt?.toISOString() ?? null,
          }
        : SIN_CUENTA,
      config: {
        activo: conectada && plataforma.lista && (fila?.depositEnabled ?? false),
        modo: (fila?.depositMode as ModoAnticipo) ?? "fixed",
        monto: fila?.depositAmount ?? 0,
        porcentaje: fila?.depositPercent ?? 0,
        minutos: fila?.holdMinutes ?? MINUTOS_DEFAULT,
      },
      comision: {
        modo: (fila?.marketplaceFeeMode as ModoComision) ?? "fixed",
        valor: fila?.marketplaceFeeValue ?? 0,
      },
      recientes: recientes.map((r) => ({
        id: r.id,
        creado: r.createdAt.toISOString(),
        paciente: `${r.patient.firstName} ${r.patient.lastName}`.trim(),
        cita: r.appointment?.startsAt.toISOString() ?? null,
        monto: r.amount,
        estado: r.status,
        pagado: r.paidAmount,
        referenciaMp: r.mpPaymentId,
        citaConfirmada: r.appointmentConfirmed,
        ultimoEstadoMp: r.lastMpStatus,
        ultimoDetalleMp: r.lastMpStatusDetail,
        avisoError: r.noticeError,
        anomalias: r.payments.map((p) => `Pago ${p.mpPaymentId}: ${p.anomaly}`),
      })),
    };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2022") return vacia(plataforma, false);
    throw e;
  }
}
