// ═══════════════════════════════════════════════════════════════════════════
// COBRO AUTOMÁTICO CON TARJETA (ws1-t6) — el servicio.
//
//   1. La clínica enciende el interruptor (Configuración → Anticipos), APAGADO de
//      fábrica, solo visible con Mercado Pago conectado.
//   2. En un caso/factura a plazos, «Activar cobro automático» crea una
//      suscripción PENDIENTE en la cuenta de la clínica (monto = la mensualidad,
//      primer cobro = la fecha de la siguiente mensualidad del plan) y devuelve el
//      link de MP donde el paciente registra su tarjeta. Nosotros nunca la vemos.
//   3. Cada cobro que MP hace llega por el webhook (`subscription_authorized_payment`)
//      o, si el aviso se pierde, por el respaldo al abrir el caso (`sincronizar`):
//        · aprobado → Payment `mercadopago` en la factura (una sola vez), recibo
//          al paciente, Movimientos, y se cierran los links de pago viejos;
//        · rechazado → aviso a recepción (Caja) y la mensualidad queda pendiente
//          para cobro manual. MP reintenta solo (hasta 4 veces en ~10 días).
//   4. Pausar / reanudar / cancelar desde el caso. Si la factura cambia (descuento,
//      cambio de plan, cobro en caja, se liquida, se cancela) o el caso se cierra,
//      `reconciliarFactura` ajusta el monto o cancela la suscripción.
//
// Todo lo que toca base, red o mensajes entra por `DepsCobro`: las pruebas lo
// conducen con un Mercado Pago simulado. NUNCA hay cobros reales en pruebas.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { getPayment, type MercadoPagoPayment } from "@/lib/mercadopago";
import { credencialDeCobro, plataformaAnticipos, urlBaseApp, type CredencialDeCobro } from "@/lib/anticipos/cuenta.server";
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
import {
  ajusteNecesario,
  casoCerrado,
  correoValido,
  cuotaQueCubre,
  decidirCobro,
  estaVivo,
  formatoPesos,
  frecuenciaMp,
  isoEnZona,
  linkSeguro,
  normalizarEstado,
  planDeCobro,
  refDeCobro,
  type CobroMp,
  type EstadoCobro,
  type MotivoSinCobro,
  type PlanDeCobro,
} from "./core";
import * as api from "./mp-api";
import { repoSql, tablasListas, type FilaCobro, type RepoCobros } from "./db";
import { leerFactura, registrarCobroEnFactura, type DatosFactura, type ResultadoRegistro } from "./factura.server";

export interface EfectosCobro {
  /** WhatsApp de recibo al paciente/responsable. Nunca lanza. */
  recibo(a: { clinicId: string; invoiceId: string; patientId: string | null; monto: number; folio: string; cuota: string | null }): Promise<void>;
  /** Movimientos del paciente. `userId` null = lo hizo Mercado Pago / el sistema. Nunca lanza. */
  movimiento(a: { clinicId: string; patientId: string | null; invoiceId: string; texto: string; userId: string | null; entityType: "invoice" | "payment"; entityId: string }): Promise<void>;
  /** El saldo de la factura cambió: cerrar links de pago viejos y refrescar Caja. Nunca lanza. */
  saldoCambio(a: { clinicId: string; invoiceId: string }): Promise<void>;
}

export interface DepsCobro {
  tablas: (forzar?: boolean) => Promise<boolean | null>;
  repo: RepoCobros;
  plataformaLista: () => boolean;
  baseUrl: () => string | null;
  credencial: (clinicId: string) => Promise<CredencialDeCobro | null>;
  /** Clínicas que conectaron la cuenta de MP `mpUserId` (puede ser más de una). */
  clinicasDeCuentaMp: (mpUserId: string) => Promise<string[]>;
  leerFactura: (clinicId: string, invoiceId: string) => Promise<DatosFactura | null>;
  registrar: (a: { clinicId: string; invoiceId: string; monto: number; referencia: string; pagadoEl: Date; nota: string }) => Promise<ResultadoRegistro>;
  mp: {
    crear: typeof api.crearSuscripcion;
    consultar: typeof api.consultarSuscripcion;
    actualizar: typeof api.actualizarSuscripcion;
    consultarCobro: typeof api.consultarCobro;
    buscarCobros: typeof api.buscarCobros;
    consultarPago: (token: string, paymentId: string) => Promise<MercadoPagoPayment | null>;
  };
  efectos: EfectosCobro;
  ahora: () => Date;
}

let efectosReales: EfectosCobro | null = null;
async function efectosPorDefecto(): Promise<EfectosCobro> {
  // Import perezoso: los efectos arrastran WhatsApp, PDF y la bitácora, y
  // factura-mp importa este módulo a través de gancho.ts.
  if (!efectosReales) efectosReales = (await import("./efectos.server")).efectos;
  return efectosReales;
}
const efectosDiferidos: EfectosCobro = {
  recibo: async (a) => (await efectosPorDefecto()).recibo(a),
  movimiento: async (a) => (await efectosPorDefecto()).movimiento(a),
  saldoCambio: async (a) => (await efectosPorDefecto()).saldoCambio(a),
};

export const depsReales: DepsCobro = {
  tablas: (forzar) => tablasListas(prisma, forzar),
  repo: repoSql(prisma),
  plataformaLista: () => plataformaAnticipos().lista,
  baseUrl: urlBaseApp,
  credencial: (clinicId) => credencialDeCobro(clinicId),
  clinicasDeCuentaMp: async (mpUserId) => {
    if (!mpUserId) return [];
    const filas = await prisma.clinicMercadoPago.findMany({
      where: { mpUserId, accessToken: { not: null } },
      select: { clinicId: true },
      take: 10,
    });
    return filas.map((f) => f.clinicId);
  },
  leerFactura: (clinicId, invoiceId) => leerFactura(prisma, clinicId, invoiceId),
  registrar: (a) => registrarCobroEnFactura(prisma, a),
  mp: {
    crear: api.crearSuscripcion,
    consultar: api.consultarSuscripcion,
    actualizar: api.actualizarSuscripcion,
    consultarCobro: api.consultarCobro,
    buscarCobros: api.buscarCobros,
    // 401/403 LANZA: con un token de OAuth es «el token ya no sirve», no «no existe».
    consultarPago: (token, id) => getPayment(token, id, { throwOnAuthError: true }),
  },
  efectos: efectosDiferidos,
  ahora: () => new Date(),
};

function deps(over?: Partial<DepsCobro>): DepsCobro {
  return over ? { ...depsReales, ...over } : depsReales;
}

/** Una fila en `creating` más vieja que esto es de un alta que murió a medias. */
const CREANDO_CADUCA_MS = 10 * 60 * 1000;

/** Cada cuánto, como mucho, el respaldo le pregunta a MP al abrir el caso. */
const SINCRONIZAR_CADA_MS = 5 * 60 * 1000;

/* ── 1. ¿Está disponible en la clínica? ──────────────────────────────── */

export interface EstadoConfig {
  /** DaleControl tiene las variables de Mercado Pago. */
  plataforma: boolean;
  /** La clínica tiene su cuenta de MP conectada. */
  conectado: boolean;
  /** El SQL de esta función ya está pegado. */
  tablas: boolean;
  encendido: boolean;
  /** Suscripciones vivas (pendientes, activas o pausadas). */
  vivos: number;
}

async function cuentaConectada(clinicId: string, d: DepsCobro): Promise<boolean> {
  if (!d.plataformaLista() || !d.baseUrl()) return false;
  return (await d.credencial(clinicId)) != null;
}

export async function estadoConfig(clinicId: string, over?: Partial<DepsCobro>): Promise<EstadoConfig> {
  const d = deps(over);
  const vacio: EstadoConfig = { plataforma: d.plataformaLista(), conectado: false, tablas: false, encendido: false, vivos: 0 };
  if (!clinicId) return vacio;
  const conectado = await cuentaConectada(clinicId, d);
  const tablas = (await d.tablas(true)) === true;
  if (!tablas) return { ...vacio, conectado };
  const [encendido, vivos] = await Promise.all([d.repo.leerInterruptor(clinicId), d.repo.contarVivos(clinicId)]);
  return { plataforma: vacio.plataforma, conectado, tablas, encendido, vivos };
}

export async function guardarInterruptor(
  a: { clinicId: string; enabled: boolean; userId: string | null },
  over?: Partial<DepsCobro>,
): Promise<{ ok: boolean; error: string | null }> {
  const d = deps(over);
  if (!a.clinicId) return { ok: false, error: "Sin clínica." };
  if ((await d.tablas(true)) !== true) {
    return { ok: false, error: "Falta pegar el SQL del cobro automático (sql/ws1-t6-cobro-automatico-mp.sql)." };
  }
  // Encender exige la cuenta; apagar se deja siempre.
  if (a.enabled && !(await cuentaConectada(a.clinicId, d))) {
    return { ok: false, error: "Conecta primero la cuenta de Mercado Pago de la clínica." };
  }
  await d.repo.guardarInterruptor(a.clinicId, a.enabled, a.userId);
  return { ok: true, error: null };
}

/* ── 2. Lo que ve el caso / la factura ───────────────────────────────── */

export interface VistaCobro {
  id: string;
  estado: EstadoCobro;
  monto: number;
  correo: string;
  /** El link para registrar la tarjeta: solo mientras está pendiente. */
  link: string | null;
  inicio: string | null;
  fin: string | null;
  proximoCobro: string | null;
  motivoCancelacion: string | null;
  creado: string;
}

function vista(f: FilaCobro): VistaCobro {
  return {
    id: f.id,
    estado: f.status,
    monto: f.amount,
    correo: f.payerEmail,
    link: f.status === "pending" ? f.initPoint : null,
    inicio: f.startDate,
    fin: f.endDate,
    proximoCobro: f.nextPaymentDate ? f.nextPaymentDate.toISOString() : null,
    motivoCancelacion: f.cancelReason,
    creado: f.createdAt.toISOString(),
  };
}

export const TEXTO_MOTIVO: Record<MotivoSinCobro | "sin_mp" | "apagado" | "sin_correo" | "no_encontrada" | "ya_hay" | "caso_cerrado" | "mp_fallo" | "otro_caso", string> = {
  no_a_plazos: "Solo se puede activar en un plan de pago a plazos.",
  sin_fechas: "El plan de pago no tiene fechas: fija la fecha del primer pago para poder cobrar solo.",
  sin_cuotas_futuras: "Ya no quedan mensualidades por venir en este plan.",
  saldada: "La factura ya está pagada.",
  cancelada: "La factura está cancelada.",
  bajo_minimo: "Lo que falta es menor al mínimo para cobrar en línea ($10 MXN).",
  sin_mp: "Esta clínica no tiene Mercado Pago conectado.",
  apagado: "El cobro automático está apagado en Configuración → Anticipos.",
  sin_correo: "Mercado Pago pide el correo del paciente (con ese correo entra a Mercado Pago a registrar su tarjeta).",
  no_encontrada: "Factura no encontrada.",
  ya_hay: "Esta factura ya tiene un cobro automático.",
  caso_cerrado: "El caso está terminado o dado de baja.",
  mp_fallo: "Mercado Pago no pudo crear el cobro automático. Intenta de nuevo en unos minutos.",
  otro_caso: "La factura no es la de este caso.",
};

export interface EstadoDeFactura {
  /** Se pinta el bloque: interruptor encendido, o hay uno vivo que se puede cancelar. */
  visible: boolean;
  /** Se ofrece «Activar»: no hay uno vivo y el plan lo permite. */
  puedeActivar: boolean;
  motivo: string | null;
  /** Lo que se le pediría a MP si se activa hoy. */
  plan: PlanDeCobro | null;
  cobro: VistaCobro | null;
  correoSugerido: string | null;
  /** Teléfono del paciente (para «Enviar por WhatsApp»), tal cual. */
  telefono: string | null;
  clinica: string | null;
}

/** Solo lee (y, si hay uno vivo, se pone al día con MP como respaldo de los avisos). */
export async function estadoDeFactura(
  a: { clinicId: string; invoiceId: string },
  over?: Partial<DepsCobro>,
): Promise<EstadoDeFactura> {
  const d = deps(over);
  const oculto: EstadoDeFactura = { visible: false, puedeActivar: false, motivo: null, plan: null, cobro: null, correoSugerido: null, telefono: null, clinica: null };
  if (!a.clinicId || !a.invoiceId) return oculto;
  if ((await d.tablas()) !== true) return oculto;
  if (!(await cuentaConectada(a.clinicId, d))) return oculto;
  const [encendido, vivo0] = await Promise.all([d.repo.leerInterruptor(a.clinicId), d.repo.vivoDeFactura(a.clinicId, a.invoiceId)]);
  if (!encendido && !vivo0) return oculto;

  if (vivo0 && vivo0.status !== "creating" && (!vivo0.lastSyncAt || d.ahora().getTime() - vivo0.lastSyncAt.getTime() > SINCRONIZAR_CADA_MS)) {
    try {
      await sincronizar(vivo0, d);
      await reconciliarFactura({ clinicId: a.clinicId, invoiceId: a.invoiceId }, d);
    } catch (e) {
      console.error(`[cobro-automatico] no se pudo poner al día ${vivo0.id}: ${(e as Error).message}`);
    }
  }

  const [factura, ultimo] = await Promise.all([
    d.leerFactura(a.clinicId, a.invoiceId),
    d.repo.ultimoDeFactura(a.clinicId, a.invoiceId),
  ]);
  if (!factura) return oculto;
  const hoy = hoyEnZona(d.ahora(), factura.clinica.timezone);
  const { plan, motivo } = planDeCobro({ condiciones: factura.condiciones, total: factura.total, pagado: factura.paid, estadoFactura: factura.status, hoy });
  const vivo = ultimo && estaVivo(ultimo.status) ? ultimo : null;
  const cerrado = casoCerrado(factura.caso?.status);
  const puedeActivar = encendido && !vivo && !!plan && !cerrado;
  return {
    visible: true,
    puedeActivar,
    motivo: vivo ? null : !encendido ? TEXTO_MOTIVO.apagado : cerrado ? TEXTO_MOTIVO.caso_cerrado : motivo ? TEXTO_MOTIVO[motivo] : null,
    plan,
    cobro: ultimo ? vista(ultimo) : null,
    correoSugerido: correoValido(factura.paciente?.email),
    telefono: factura.paciente?.telefono ?? null,
    clinica: factura.clinica.nombre,
  };
}

/* ── 3. Activar ──────────────────────────────────────────────────────── */

export interface ResultadoAccion {
  ok: boolean;
  error: string | null;
  cobro: VistaCobro | null;
}

function falla(error: string): ResultadoAccion {
  return { ok: false, error, cobro: null };
}

export async function activar(
  a: { clinicId: string; invoiceId: string; userId: string; correo: string | null; treatmentPlanId?: string | null },
  over?: Partial<DepsCobro>,
): Promise<ResultadoAccion> {
  const d = deps(over);
  if (!a.clinicId || !a.invoiceId) return falla(TEXTO_MOTIVO.no_encontrada);
  if ((await d.tablas()) !== true) return falla(TEXTO_MOTIVO.apagado);
  if (!(await d.repo.leerInterruptor(a.clinicId))) return falla(TEXTO_MOTIVO.apagado);
  const base = d.baseUrl();
  const cred = d.plataformaLista() && base ? await d.credencial(a.clinicId) : null;
  if (!cred || !base) return falla(TEXTO_MOTIVO.sin_mp);

  const factura = await d.leerFactura(a.clinicId, a.invoiceId);
  if (!factura) return falla(TEXTO_MOTIVO.no_encontrada);
  if (a.treatmentPlanId && factura.caso?.id !== a.treatmentPlanId) return falla(TEXTO_MOTIVO.otro_caso);
  if (casoCerrado(factura.caso?.status)) return falla(TEXTO_MOTIVO.caso_cerrado);
  const hoy = hoyEnZona(d.ahora(), factura.clinica.timezone);
  const { plan, motivo } = planDeCobro({ condiciones: factura.condiciones, total: factura.total, pagado: factura.paid, estadoFactura: factura.status, hoy });
  if (!plan) return falla(TEXTO_MOTIVO[motivo ?? "no_a_plazos"]);
  const correo = correoValido(a.correo ?? factura.paciente?.email);
  if (!correo) return falla(TEXTO_MOTIVO.sin_correo);

  // Una fila que se quedó «creándose» (el servidor murió esperando a MP) no puede
  // bloquear para siempre: sin link, esa suscripción nunca tuvo tarjeta ni cobró.
  const atorada = await d.repo.vivoDeFactura(a.clinicId, a.invoiceId);
  if (atorada?.status === "creating" && d.ahora().getTime() - atorada.createdAt.getTime() > CREANDO_CADUCA_MS) {
    await d.repo.borrarCreando(a.clinicId, atorada.id);
  }

  const fila = await d.repo.crear({
    clinicId: a.clinicId,
    invoiceId: a.invoiceId,
    patientId: factura.patientId,
    treatmentPlanId: factura.caso?.id ?? null,
    mpCollectorId: cred.mpUserId,
    amount: plan.monto,
    payerEmail: correo,
    startDate: plan.inicio,
    endDate: plan.fin,
    createdById: a.userId,
  });
  if (!fila) return falla(TEXTO_MOTIVO.ya_hay);

  let sus: api.SuscripcionMp;
  try {
    const tz = factura.clinica.timezone;
    sus = await d.mp.crear(cred.accessToken, {
      reason: `Mensualidades · factura ${factura.invoiceNumber} · ${factura.clinica.nombre}`.slice(0, 250),
      externalReference: refDeCobro(fila.id),
      payerEmail: correo,
      backUrl: `${base}/pago/cobro-automatico`,
      autoRecurring: {
        ...frecuenciaMp(plan.frecuencia),
        // A media mañana de la clínica: el día del plan, sin caer al día anterior por zona.
        start_date: isoEnZona(plan.inicio, "10:00:00", tz),
        end_date: isoEnZona(plan.fin, "23:00:00", tz),
        transaction_amount: plan.monto,
      },
    });
  } catch (e) {
    await d.repo.borrarCreando(a.clinicId, fila.id).catch(() => {});
    console.error(`[cobro-automatico] MP no creó la suscripción (factura ${a.invoiceId}): ${(e as Error).message}`);
    const detalle = e instanceof api.ErrorMp ? ` (${e.message})` : "";
    return falla(`${TEXTO_MOTIVO.mp_fallo}${detalle}`);
  }

  const link = linkSeguro(sus.initPoint);
  if (!link) {
    // Sin link no hay cómo registrar la tarjeta: se cancela en MP y no queda nada vivo.
    await d.mp.actualizar(cred.accessToken, sus.id, { status: "cancelled" }).catch(() => {});
    await d.repo.borrarCreando(a.clinicId, fila.id).catch(() => {});
    return falla(TEXTO_MOTIVO.mp_fallo);
  }
  const estado = normalizarEstado(sus.status ?? "pending");
  await d.repo.actualizar(a.clinicId, fila.id, { mpPreapprovalId: sus.id, initPoint: link, status: estado, lastSyncAt: d.ahora() });

  await d.efectos.movimiento({
    clinicId: a.clinicId,
    patientId: factura.patientId,
    invoiceId: a.invoiceId,
    entityType: "invoice",
    entityId: a.invoiceId,
    userId: a.userId,
    texto: `Activó el cobro automático con tarjeta (Mercado Pago) de la factura ${factura.invoiceNumber}: ${formatoPesos(plan.monto)} desde el ${plan.inicio}. Falta que el paciente registre su tarjeta con el link.`,
  });
  return { ok: true, error: null, cobro: vista({ ...fila, mpPreapprovalId: sus.id, initPoint: link, status: estado }) };
}

/* ── 4. Pausar / reanudar / cancelar ─────────────────────────────────── */

export type AccionCobro = "pausar" | "reanudar" | "cancelar";

export async function cambiarEstado(
  a: { clinicId: string; invoiceId: string; userId: string; accion: AccionCobro },
  over?: Partial<DepsCobro>,
): Promise<ResultadoAccion> {
  const d = deps(over);
  if (!a.clinicId || !a.invoiceId) return falla(TEXTO_MOTIVO.no_encontrada);
  if ((await d.tablas()) !== true) return falla(TEXTO_MOTIVO.apagado);
  const fila = await d.repo.vivoDeFactura(a.clinicId, a.invoiceId);
  if (!fila) return falla("Esta factura no tiene un cobro automático activo.");
  if (fila.status === "creating") return falla("El cobro automático se está creando; intenta en unos segundos.");
  if (a.accion === "pausar" && fila.status !== "authorized") return falla("Solo se puede pausar un cobro automático activo.");
  if (a.accion === "reanudar" && fila.status !== "paused") return falla("Solo se puede reanudar un cobro automático pausado.");

  const destino = a.accion === "pausar" ? "paused" : a.accion === "reanudar" ? "authorized" : "cancelled";
  let estado: EstadoCobro = destino;
  if (fila.mpPreapprovalId) {
    const cred = await d.credencial(a.clinicId);
    if (!cred) return falla(TEXTO_MOTIVO.sin_mp);
    try {
      const sus = await d.mp.actualizar(cred.accessToken, fila.mpPreapprovalId, { status: destino });
      estado = sus.status ? normalizarEstado(sus.status) : destino;
    } catch (e) {
      console.error(`[cobro-automatico] MP no aceptó «${a.accion}» (${fila.id}): ${(e as Error).message}`);
      return falla(`Mercado Pago no aceptó el cambio. ${e instanceof api.ErrorMp ? e.message : "Intenta de nuevo en unos minutos."}`);
    }
  }
  await d.repo.actualizar(a.clinicId, fila.id, {
    status: estado,
    ...(estado === "cancelled" ? { cancelReason: "Cancelado desde el panel." } : {}),
  });
  const factura = await d.leerFactura(a.clinicId, a.invoiceId);
  const verbo = a.accion === "pausar" ? "Pausó" : a.accion === "reanudar" ? "Reanudó" : "Canceló";
  await d.efectos.movimiento({
    clinicId: a.clinicId,
    patientId: factura?.patientId ?? fila.patientId,
    invoiceId: a.invoiceId,
    entityType: "invoice",
    entityId: a.invoiceId,
    userId: a.userId,
    texto: `${verbo} el cobro automático con tarjeta de la factura ${factura?.invoiceNumber ?? ""}`.trim(),
  });
  if (a.accion === "reanudar") await reconciliarFactura({ clinicId: a.clinicId, invoiceId: a.invoiceId }, d);
  const despues = await d.repo.porId(a.clinicId, fila.id);
  return { ok: true, error: null, cobro: despues ? vista(despues) : null };
}

/* ── 5. Reconciliar con la factura ───────────────────────────────────── */

/**
 * Lleva la suscripción a lo que la factura dice HOY. La llaman: el gancho de
 * `cerrarLinksDeFactura` (todo cambio de saldo: cobro en caja, descuento,
 * cambio de precio, cancelar, reembolso), el cambio de plan de pago, el cambio
 * de estado del caso, el webhook después de un cobro y el respaldo al abrir el
 * caso. NUNCA lanza: lo que la llamó ya hizo lo suyo.
 */
export async function reconciliarFactura(
  a: { clinicId: string; invoiceId: string },
  over?: Partial<DepsCobro> | DepsCobro,
): Promise<"nada" | "monto" | "cancelada" | "error"> {
  const d = deps(over);
  try {
    if (!a.clinicId || !a.invoiceId) return "nada";
    if ((await d.tablas()) !== true) return "nada";
    const fila = await d.repo.vivoDeFactura(a.clinicId, a.invoiceId);
    if (!fila) return "nada";
    const factura = await d.leerFactura(a.clinicId, a.invoiceId);
    const hoy = hoyEnZona(d.ahora(), factura?.clinica.timezone ?? "America/Mexico_City");
    const plan = factura
      ? planDeCobro({ condiciones: factura.condiciones, total: factura.total, pagado: factura.paid, estadoFactura: factura.status, hoy })
      : { plan: null, motivo: "cancelada" as const };
    const ajuste = ajusteNecesario({ estado: fila.status, montoActual: fila.amount, plan, casoCerrado: casoCerrado(factura?.caso?.status) });
    if (ajuste.accion === "nada") return "nada";

    const cred = fila.mpPreapprovalId ? await d.credencial(a.clinicId) : null;
    if (fila.mpPreapprovalId && !cred) {
      console.error(`[cobro-automatico] ${fila.id}: hay que ${ajuste.accion === "monto" ? "cambiar el monto" : "cancelar"} y la clínica no tiene cuenta de MP`);
      return "error";
    }
    if (ajuste.accion === "monto") {
      if (cred && fila.mpPreapprovalId) await d.mp.actualizar(cred.accessToken, fila.mpPreapprovalId, { monto: ajuste.monto });
      await d.repo.actualizar(a.clinicId, fila.id, { amount: ajuste.monto });
      await d.efectos.movimiento({
        clinicId: a.clinicId, patientId: fila.patientId, invoiceId: a.invoiceId, entityType: "invoice", entityId: a.invoiceId, userId: null,
        texto: `El cobro automático con tarjeta cambió de ${formatoPesos(fila.amount)} a ${formatoPesos(ajuste.monto)} porque cambió la factura.`,
      });
      return "monto";
    }
    if (cred && fila.mpPreapprovalId) await d.mp.actualizar(cred.accessToken, fila.mpPreapprovalId, { status: "cancelled" });
    await d.repo.actualizar(a.clinicId, fila.id, { status: "cancelled", cancelReason: ajuste.motivo });
    await d.efectos.movimiento({
      clinicId: a.clinicId, patientId: fila.patientId, invoiceId: a.invoiceId, entityType: "invoice", entityId: a.invoiceId, userId: null,
      texto: `El cobro automático con tarjeta se canceló solo: ${ajuste.motivo}`,
    });
    return "cancelada";
  } catch (e) {
    console.error(`[cobro-automatico] no se pudo reconciliar la factura ${a.invoiceId}: ${(e as Error).message}`);
    return "error";
  }
}

/* ── 6. Avisos de Mercado Pago (webhook) y respaldo ──────────────────── */

/** Aviso a recepción de una suscripción que MP canceló por su lado (3 rechazos, o el paciente). */
const PREFIJO_CANCELADA = "suscripcion-cancelada:";

async function ponerAlDiaEstado(fila: FilaCobro, sus: api.SuscripcionMp, d: DepsCobro): Promise<void> {
  if (sus.externalReference !== refDeCobro(fila.id)) {
    console.error(`[cobro-automatico] la suscripción ${sus.id} no es la de ${fila.id} (ref ${sus.externalReference ?? "-"}): no se toca`);
    return;
  }
  const nuevo = normalizarEstado(sus.status);
  const antes = fila.status;
  const proximo = sus.nextPaymentDate ? new Date(sus.nextPaymentDate) : null;
  const cambios: Parameters<RepoCobros["actualizar"]>[2] = {
    lastSyncAt: d.ahora(),
    ...(proximo && !isNaN(proximo.getTime()) ? { nextPaymentDate: proximo } : {}),
  };
  if (sus.status && nuevo !== antes && antes !== "cancelled") {
    cambios.status = nuevo;
    if (nuevo === "cancelled") cambios.cancelReason = "Mercado Pago: la suscripción se canceló por su lado (cobros rechazados o el paciente la dio de baja).";
  }
  await d.repo.actualizar(fila.clinicId, fila.id, cambios);
  if (!cambios.status) return;

  if (nuevo === "authorized" && antes === "pending") {
    await d.efectos.movimiento({
      clinicId: fila.clinicId, patientId: fila.patientId, invoiceId: fila.invoiceId, entityType: "invoice", entityId: fila.invoiceId, userId: null,
      texto: `El paciente registró su tarjeta en Mercado Pago: el cobro automático de ${formatoPesos(fila.amount)} quedó activo.`,
    });
  }
  if (nuevo === "cancelled") {
    await d.repo.guardarIntento({
      clinicId: fila.clinicId, cobroId: fila.id, mpAuthorizedPaymentId: `${PREFIJO_CANCELADA}${sus.id}`, mpPaymentId: null,
      status: "cancelled", paymentStatus: null, statusDetail: "La suscripción se canceló en Mercado Pago", amount: null, avisoRecepcion: true,
    });
    await d.efectos.movimiento({
      clinicId: fila.clinicId, patientId: fila.patientId, invoiceId: fila.invoiceId, entityType: "invoice", entityId: fila.invoiceId, userId: null,
      texto: "Mercado Pago canceló el cobro automático con tarjeta. Las mensualidades que falten se cobran a mano.",
    });
  }
}

/**
 * Un cobro de la suscripción, ya consultado a MP con el token de la clínica.
 * Idempotente: el mismo cobro puede llegar por el webhook (varias veces) y por
 * el respaldo; el dinero se registra una sola vez (Payment por referencia, bajo
 * el FOR UPDATE de la factura). Lanza solo en lo transitorio.
 */
async function aplicarCobroMp(fila: FilaCobro, c: CobroMp, cred: CredencialDeCobro, d: DepsCobro): Promise<"registrado" | "rechazado" | "nada"> {
  if (!fila.mpPreapprovalId) return "nada";
  const dec = decidirCobro(c, fila.mpPreapprovalId);
  if (dec.accion === "ignorar") {
    console.error(`[cobro-automatico] cobro ${c.id} ignorado para ${fila.id}: ${dec.motivo}`);
    return "nada";
  }
  const previo = await d.repo.intentoPorMp(fila.clinicId, c.id);
  const base = {
    clinicId: fila.clinicId, cobroId: fila.id, mpAuthorizedPaymentId: c.id, mpPaymentId: c.paymentId,
    status: c.status, paymentStatus: c.paymentStatus, statusDetail: c.paymentStatusDetail, amount: c.transactionAmount,
  };
  if (dec.accion === "esperar") {
    // Sin dinero ni rechazo todavía: se anota sin apagar un aviso que ya hubiera.
    if (!previo?.paymentRowId) await d.repo.guardarIntento({ ...base, avisoRecepcion: previo?.avisoRecepcion ?? false });
    return "nada";
  }
  if (dec.accion === "rechazado") {
    if (previo?.paymentRowId) return "nada"; // ya entró el dinero por este cobro: un aviso viejo no lo deshace
    await d.repo.guardarIntento({ ...base, avisoRecepcion: true });
    if (previo?.paymentStatus !== "rejected") {
      const factura = await d.leerFactura(fila.clinicId, fila.invoiceId);
      await d.efectos.movimiento({
        clinicId: fila.clinicId, patientId: fila.patientId, invoiceId: fila.invoiceId, entityType: "invoice", entityId: fila.invoiceId, userId: null,
        texto: `Mercado Pago rechazó el cobro automático de ${formatoPesos(c.transactionAmount ?? fila.amount)} de la factura ${factura?.invoiceNumber ?? ""}. ${dec.definitivo ? "Ya no lo reintentará" : "Lo reintentará en los próximos días"}; la mensualidad sigue pendiente y se puede cobrar a mano.`,
      });
    }
    return "rechazado";
  }

  // Aprobado: el dinero se cree solo con el PAGO consultado a MP.
  const pago = await d.mp.consultarPago(cred.accessToken, dec.paymentId);
  if (!pago || pago.status !== "approved") return "nada";
  if (fila.mpCollectorId && pago.collectorId && pago.collectorId !== fila.mpCollectorId) {
    console.error(`[cobro-automatico] pago ${pago.id}: lo cobró otra cuenta (${pago.collectorId} ≠ ${fila.mpCollectorId}); no se registra`);
    return "nada";
  }
  if (pago.currencyId && pago.currencyId !== "MXN") return "nada";
  const monto = pago.transactionAmount ?? 0;
  if (!(monto > 0)) return "nada";

  const ahora = d.ahora();
  const aprobado = pago.dateApproved ? new Date(pago.dateApproved) : null;
  const pagadoEl = aprobado && !isNaN(aprobado.getTime()) && aprobado.getTime() <= ahora.getTime() ? aprobado : ahora;
  const r = await d.registrar({
    clinicId: fila.clinicId,
    invoiceId: fila.invoiceId,
    monto,
    referencia: pago.id,
    pagadoEl,
    nota: "Cobro automático con tarjeta (Mercado Pago)",
  });
  await d.repo.guardarIntento({ ...base, mpPaymentId: pago.id, paymentRowId: r.paymentRowId, avisoRecepcion: false });
  if (!r.aplicado) return "nada";

  const factura = await d.leerFactura(fila.clinicId, fila.invoiceId);
  let cuota: string | null = null;
  if (factura) {
    const q = cuotaQueCubre(factura.condiciones, factura.total, r.pagadoAntes, hoyEnZona(ahora, factura.clinica.timezone));
    cuota = q ? `mensualidad ${q.numero} de ${q.de}` : null;
  }
  await d.efectos.movimiento({
    clinicId: fila.clinicId, patientId: fila.patientId, invoiceId: fila.invoiceId, entityType: "payment", entityId: r.paymentRowId ?? fila.invoiceId, userId: null,
    texto: `Cobro automático con tarjeta aprobado: ${formatoPesos(monto)}${cuota ? ` (${cuota})` : ""} de la factura ${factura?.invoiceNumber ?? ""}.${r.anomalia ? ` ⚠️ ${r.anomalia}.` : ""}`,
  });
  await d.efectos.recibo({ clinicId: fila.clinicId, invoiceId: fila.invoiceId, patientId: fila.patientId, monto, folio: factura?.invoiceNumber ?? "", cuota });
  // Cierra links de pago por el saldo viejo y, por el gancho, reconcilia el monto.
  await d.efectos.saldoCambio({ clinicId: fila.clinicId, invoiceId: fila.invoiceId });
  return "registrado";
}

/** Respaldo: pregunta a MP el estado y los cobros de la suscripción. Lanza en lo transitorio. */
export async function sincronizar(fila: FilaCobro, over?: Partial<DepsCobro> | DepsCobro): Promise<void> {
  const d = deps(over);
  if (!fila.mpPreapprovalId) return;
  const cred = await d.credencial(fila.clinicId);
  if (!cred) return;
  const sus = await d.mp.consultar(cred.accessToken, fila.mpPreapprovalId);
  if (sus) await ponerAlDiaEstado(fila, sus, d);
  else await d.repo.actualizar(fila.clinicId, fila.id, { lastSyncAt: d.ahora() });
  for (const c of await d.mp.buscarCobros(cred.accessToken, fila.mpPreapprovalId)) {
    await aplicarCobroMp(fila, c, cred, d);
  }
}

export type TipoAvisoMp = "subscription_preapproval" | "subscription_authorized_payment";

export function esAvisoDeSuscripcion(tipo: string | null): tipo is TipoAvisoMp {
  return tipo === "subscription_preapproval" || tipo === "subscription_authorized_payment";
}

/**
 * Un aviso FIRMADO de Mercado Pago sobre suscripciones. Del cuerpo solo se usan
 * el id del recurso (el firmado) y, para un cobro, el `user_id` (la cuenta del
 * vendedor) para saber con el token de qué clínica PREGUNTARLE a MP; lo que
 * cuenta es lo que MP contesta, y el cobro tiene que ser de una suscripción
 * nuestra de ESA clínica.
 *
 *   · Devuelve (→ 200) en lo determinista: tablas sin pegar, suscripción ajena…
 *   · LANZA (→ 500, MP reintenta) en lo transitorio: red/5xx de MP, token que MP
 *     rechaza, base caída o que no contesta, la clínica sin cuenta.
 */
export async function procesarAvisoDeSuscripcion(
  a: { tipo: TipoAvisoMp; dataId: string; mpUserId: string | null },
  over?: Partial<DepsCobro>,
): Promise<string> {
  const d = deps(over);
  const tablas = await d.tablas();
  if (tablas === null) throw new Error("no se pudo comprobar las tablas del cobro automático");
  if (!tablas || !a.dataId) return "sin tablas o sin id";

  if (a.tipo === "subscription_preapproval") {
    const fila = await d.repo.porPreapproval(a.dataId);
    if (!fila) return "suscripción ajena";
    const cred = await d.credencial(fila.clinicId);
    if (!cred) throw new Error("clínica sin cuenta de Mercado Pago para verificar la suscripción");
    const sus = await d.mp.consultar(cred.accessToken, a.dataId);
    if (!sus) return "MP no encuentra la suscripción";
    await ponerAlDiaEstado(fila, sus, d);
    return "estado al día";
  }

  if (!a.mpUserId) {
    console.error(`[cobro-automatico] aviso del cobro ${a.dataId} sin user_id: lo recoge el respaldo al abrir el caso`);
    return "sin cuenta";
  }
  for (const clinicId of await d.clinicasDeCuentaMp(a.mpUserId)) {
    const cred = await d.credencial(clinicId);
    if (!cred) continue;
    const c = await d.mp.consultarCobro(cred.accessToken, a.dataId);
    if (!c?.preapprovalId) continue;
    const fila = await d.repo.porPreapproval(c.preapprovalId);
    if (!fila || fila.clinicId !== clinicId) continue;
    return aplicarCobroMp(fila, c, cred, d);
  }
  return "cobro ajeno";
}

/* ── 7. Avisos a recepción ───────────────────────────────────────────── */

export interface CobroPorRevisar {
  id: string;
  paciente: string;
  invoiceId: string;
  folio: string | null;
  monto: number | null;
  motivo: string;
  creado: string;
}

/** Texto para recepción de los detalles de rechazo más comunes de MP (status_detail). */
function motivoRechazo(detalle: string | null, status: string | null): string {
  if (status === "cancelled") return "Mercado Pago canceló el cobro automático. Cobra las mensualidades a mano.";
  const conocidos: Record<string, string> = {
    cc_rejected_insufficient_amount: "fondos insuficientes",
    cc_rejected_card_disabled: "tarjeta deshabilitada",
    cc_rejected_bad_filled_date: "tarjeta vencida o con fecha mal capturada",
    cc_rejected_call_for_authorize: "el banco pide que el paciente autorice el cargo",
    cc_rejected_high_risk: "rechazado por seguridad",
    cc_rejected_other_reason: "el banco lo rechazó",
  };
  const porque = detalle ? conocidos[detalle] ?? detalle : null;
  return `Cobro automático rechazado${porque ? ` (${porque})` : ""}. La mensualidad sigue pendiente: cóbrala a mano.`;
}

export async function porRevisar(clinicId: string, over?: Partial<DepsCobro>): Promise<CobroPorRevisar[]> {
  const d = deps(over);
  if (!clinicId || (await d.tablas()) !== true) return [];
  const filas = await d.repo.porRevisar(clinicId);
  return filas.map((f) => ({
    id: f.id,
    paciente: f.paciente,
    invoiceId: f.invoiceId,
    folio: f.invoiceNumber,
    monto: f.amount,
    motivo: motivoRechazo(f.statusDetail, f.status === "cancelled" && f.mpAuthorizedPaymentId.startsWith(PREFIJO_CANCELADA) ? "cancelled" : null),
    creado: f.createdAt.toISOString(),
  }));
}

export async function marcarRevisado(a: { clinicId: string; id: string; userId: string }, over?: Partial<DepsCobro>): Promise<boolean> {
  const d = deps(over);
  if (!a.clinicId || !a.id || (await d.tablas()) !== true) return false;
  return d.repo.marcarRevisado(a.clinicId, a.id, a.userId);
}
