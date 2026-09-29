// Lo que la pantalla Configuración → Anticipos por WhatsApp puede ver (WS1-T5).
//
// Sin secretos: de la cuenta de Mercado Pago salen apodo, correo, el id
// enmascarado y fechas. Nunca el token, ni un trozo.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enmascarar, plataformaAnticipos, type EstadoCuentaMp, type PlataformaAnticipos } from "./cuenta.server";
import { MINUTOS_DEFAULT, PANEL_HORAS_DEFAULT, type ModoAnticipo, type ModoAnticipoPanel, type ModoComision } from "./core";
import { leerDatosBancarios, leerDatosBancariosParaEditar, type CuentaBancariaSede, type DbBancario } from "./datos-bancarios.server";
import { parseWaTemplates } from "@/lib/whatsapp/template-config";

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
  /**
   * Anticipo pedido DESDE EL PANEL (cita o factura), ws1-t3 fase 1-2. Config
   * PROPIA, separada de `config` de arriba (el bot no se toca). `disponible` =
   * hay Mercado Pago conectado O datos bancarios cargados (fase 2): los dos
   * canales son INDEPENDIENTES (ver canalesAnticipoPanel en panel.server.ts),
   * así que esta sección no puede depender solo de Mercado Pago (ws1-t1,
   * hallazgo M5) — una clínica que solo cobra por transferencia también
   * necesita fijar su sugerido/plazo.
   */
  configPanel: { disponible: boolean; modo: ModoAnticipoPanel; monto: number; porcentaje: number; horas: number };
  /**
   * Pago en línea desde el portal del paciente (ws1-t2), APARTE del anticipo.
   * `activo` solo puede ser true con cuenta conectada; la columna arranca en
   * true (DEFAULT, y en la primera conexión); reconectar no lo cambia.
   */
  portal: { activo: boolean };
  /** Solo lectura para la clínica: la fija DaleControl. Arranca en 0. */
  comision: { modo: ModoComision; valor: number };
  recientes: AnticipoReciente[];
  /**
   * Datos bancarios de la sede (ws1-t3 fase 2), para «Pedir anticipo →
   * Transferencia» y su PDF/texto. null = no cargados o incompletos (la
   * CLABE no pasa el dígito verificador): en ese estado el canal
   * "transferencia" NO se ofrece en ningún endpoint de anticipo, aunque haya
   * fila a medio llenar — `datosBancariosParaEditar` es la que sí trae lo
   * incompleto, para no perderlo en el formulario.
   */
  datosBancarios: (Partial<CuentaBancariaSede> & { updatedAt: string | null }) | null;
  /**
   * Las dos plantillas OPCIONALES de esta ola (ws1-t3 fase 3): el link de
   * anticipo (dc_anticipo_cita) y el recibo (dc_recibo_pago). `encendida` =
   * la clínica ya la dio de alta (hay entrada en Clinic.waTemplates,
   * cualquier estado); `estado` es lo que Meta reportó la última vez
   * (PENDING/APPROVED/REJECTED) o null si se registró sin ese dato.
   */
  plantillas: {
    anticipo: { encendida: boolean; estado: string | null };
    recibo: { encendida: boolean; estado: string | null };
  };
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

const PLANTILLAS_VACIAS: PantallaAnticipos["plantillas"] = {
  anticipo: { encendida: false, estado: null },
  recibo: { encendida: false, estado: null },
};

function vacia(
  plataforma: PlataformaAnticipos,
  tablasListas: boolean,
  datosBancarios: PantallaAnticipos["datosBancarios"] = null,
  plantillas: PantallaAnticipos["plantillas"] = PLANTILLAS_VACIAS,
): PantallaAnticipos {
  return {
    tablasListas,
    plataforma,
    cuenta: SIN_CUENTA,
    config: { activo: false, modo: "fixed", monto: 0, porcentaje: 0, minutos: MINUTOS_DEFAULT },
    configPanel: { disponible: false, modo: "fixed", monto: 0, porcentaje: 0, horas: PANEL_HORAS_DEFAULT },
    portal: { activo: false },
    comision: { modo: "fixed", valor: 0 },
    recientes: [],
    datosBancarios,
    plantillas,
  };
}

/**
 * Plantillas OPCIONALES de esta ola (ws1-t3 fase 3): lee `Clinic.waTemplates`
 * directo (columna que ya existe desde WS1-T5 — sin tolerancia P2022, no hace
 * falta). NUNCA lanza: una clínica sin fila de Clinic (no debería pasar) se
 * calla con las dos apagadas.
 */
async function leerPlantillasOpcionales(clinicId: string, db: DbPantallaAnticipos): Promise<PantallaAnticipos["plantillas"]> {
  if (!clinicId) return PLANTILLAS_VACIAS;
  const fila = await db.clinic.findUnique({ where: { id: clinicId }, select: { waTemplates: true } }).catch(() => null);
  const mapa = parseWaTemplates(fila?.waTemplates ?? null);
  const deposito = mapa.deposit_request;
  const recibo = mapa.payment_receipt;
  return {
    anticipo: { encendida: !!deposito, estado: deposito?.status ?? null },
    recibo: { encendida: !!recibo, estado: recibo?.status ?? null },
  };
}

const SELECT_CUENTA = {
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
  portalPaymentsEnabled: true,
  marketplaceFeeMode: true,
  marketplaceFeeValue: true,
  // ¿Hay token? Se pregunta por la fecha, no se lee el token.
  tokenExpiresAt: true,
} satisfies Prisma.ClinicMercadoPagoSelect;

// ws1-t3 fase 1 — EN SU PROPIA CONSULTA, separada de SELECT_CUENTA a
// propósito: dev.108 apunta a la base de PRODUCCIÓN, y hasta que se pegue
// sql/anticipo-desde-panel.sql estas 4 columnas no existen. Si estuvieran en
// el mismo `select` que la cuenta, una consulta rota se llevaría entre las
// patas la pantalla del BOT (que ya funciona hoy) — no solo la de este panel.
const SELECT_CUENTA_PANEL = {
  panelDepositMode: true,
  panelDepositAmount: true,
  panelDepositPercent: true,
  panelDepositExpiryHours: true,
} satisfies Prisma.ClinicMercadoPagoSelect;

const SELECT_RECIENTE = {
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
} satisfies Prisma.AppointmentDepositSelect;

/**
 * Lo único que esta lectura le pide a la base. Existe para que Sabina
 * (`estado_mercado_pago`) lea EXACTAMENTE lo que pinta esta pantalla pasando su
 * propio cliente —el de solo lectura, o el doble de sus pruebas— en vez de
 * reescribir la consulta. Por defecto es el `prisma` del repo.
 */
export interface DbPantallaAnticipos extends DbBancario {
  clinicMercadoPago: {
    // Dos lecturas de la misma tabla, cada una con su `select`: la cuenta (SELECT_CUENTA) y, en SU PROPIA consulta
    // por si falta su SQL, la config del anticipo pedido desde el panel (SELECT_CUENTA_PANEL, `leerConfigPanel`).
    findUnique<S extends typeof SELECT_CUENTA | typeof SELECT_CUENTA_PANEL>(args: {
      where: { clinicId: string };
      select: S;
    }): Promise<Prisma.ClinicMercadoPagoGetPayload<{ select: S }> | null>;
  };
  // Las plantillas de WhatsApp de la clínica (`leerPlantillasOpcionales`).
  clinic: {
    findUnique(args: { where: { id: string }; select: { waTemplates: true } }): Promise<
      Prisma.ClinicGetPayload<{ select: { waTemplates: true } }> | null
    >;
  };
  appointmentDeposit: {
    findMany(args: {
      where: { clinicId: string };
      orderBy: { createdAt: "desc" };
      take: number;
      select: typeof SELECT_RECIENTE;
    }): Promise<Array<Prisma.AppointmentDepositGetPayload<{ select: typeof SELECT_RECIENTE }>>>;
  };
}

/**
 * Config del anticipo pedido desde el panel — EN SU PROPIA CONSULTA, PROPIO
 * try/catch: sin sql/anticipo-desde-panel.sql aplicado, esto se calla
 * (`disponible: false` + los defaults) sin tumbar el resto de la pantalla,
 * que sigue leyendo las columnas de siempre.
 *
 * Con el `db` inyectado, como todas las lecturas de esta pantalla: la lee igual el
 * panel (el `prisma` real) que Sabina (`ctx.db`, solo lectura); una lectura con
 * el `prisma` global se saltaría el contrato del segundo.
 */
async function leerConfigPanel(
  clinicId: string,
  puedeCobrar: boolean,
  db: DbPantallaAnticipos,
): Promise<PantallaAnticipos["configPanel"]> {
  try {
    const fila = await db.clinicMercadoPago.findUnique({ where: { clinicId }, select: SELECT_CUENTA_PANEL });
    return {
      disponible: puedeCobrar,
      modo: (fila?.panelDepositMode as ModoAnticipoPanel) ?? "fixed",
      monto: fila?.panelDepositAmount ?? 0,
      porcentaje: fila?.panelDepositPercent ?? 0,
      horas: fila?.panelDepositExpiryHours ?? PANEL_HORAS_DEFAULT,
    };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2022") {
      return { disponible: false, modo: "fixed", monto: 0, porcentaje: 0, horas: PANEL_HORAS_DEFAULT };
    }
    throw e;
  }
}

export async function leerPantallaAnticipos(
  clinicId: string,
  db: DbPantallaAnticipos = prisma,
): Promise<PantallaAnticipos> {
  const plataforma = plataformaAnticipos();
  if (!clinicId) return vacia(plataforma, true);

  // Datos bancarios (fase 2) y plantillas opcionales (fase 3) — EN SU PROPIA
  // lectura, fuera del try/catch de abajo: son tablas/columnas propias, y una
  // que falte no debe apagar la otra ni el resto de la pantalla (mismo
  // criterio que leerConfigPanel).
  const [datosBancarios, plantillas, transferenciaDisponible] = await Promise.all([
    leerDatosBancariosParaEditar(clinicId, db),
    leerPlantillasOpcionales(clinicId, db),
    // "Usable" de verdad (CLABE con dígito verificador válido), no solo
    // "algo guardado": el mismo criterio que decide si el canal transferencia
    // se ofrece en «Pedir anticipo» (canalesAnticipoPanel).
    leerDatosBancarios(clinicId, db).then((v) => !!v),
  ]);

  try {
    const [fila, recientes] = await Promise.all([
      db.clinicMercadoPago.findUnique({
        where: { clinicId },
        select: SELECT_CUENTA,
      }),
      db.appointmentDeposit.findMany({
        where: { clinicId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: SELECT_RECIENTE,
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
      configPanel: await leerConfigPanel(clinicId, (conectada && plataforma.lista) || transferenciaDisponible, db),
      portal: { activo: conectada && plataforma.lista && fila?.portalPaymentsEnabled !== false },
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
      datosBancarios,
      plantillas,
    };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2021" || code === "P2022") return vacia(plataforma, false, datosBancarios, plantillas);
    throw e;
  }
}
