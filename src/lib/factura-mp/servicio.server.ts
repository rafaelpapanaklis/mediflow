// Mercado Pago como MÉTODO DE PAGO de una factura (ws1-t1) — el servicio.
//
//   1. Recepción elige «Mercado Pago» (al crear la factura o al cobrarla), o la
//      manda por correo/WhatsApp con el link.
//   2. `obtenerLinkDeFactura`: el servidor lee el SALDO de la factura y crea la
//      preferencia EN LA CUENTA DE LA CLÍNICA (la que conectó para anticipos),
//      sin comisión. Si ya hay un link vigente por ese mismo saldo, lo reutiliza:
//      el correo, el WhatsApp y el botón «copiar» reparten el MISMO link.
//   3. El paciente paga → webhook (`?ref=factura:<linkId>`) →
//      `aplicarPagoDeFactura`: re-consulta el pago a MP con el token de la
//      clínica y lo registra como un Payment `mercadopago` con la referencia del
//      pago de MP. La factura pasa a PARTIAL/PAID sola.
//
// Lo que NO se reinventa: la cuenta y sus tokens (anticipos/cuenta.server.ts),
// la preferencia y la consulta del pago (lib/mercadopago.ts), la firma del
// webhook (api/webhooks/mercadopago) y el criterio de aplicar un pago en línea a
// una factura (patient-portal/online-payment.ts: FOR UPDATE sobre la factura,
// dedup por referencia, saldo por total − paid, y lo raro se registra marcado).
//
// Todo lo que toca base o red entra por `DepsFacturaMp`: las pruebas lo
// conducen con una base en memoria y un Mercado Pago de mentira.

import { prisma } from "@/lib/prisma";
import { createPreference, expirePreference, getPayment } from "@/lib/mercadopago";
import type { CreatePreferenceOptions, CreatePreferenceResult, MercadoPagoPayment } from "@/lib/mercadopago";
import { credencialDeCobro, plataformaAnticipos, urlBaseApp, type CredencialDeCobro } from "@/lib/anticipos/cuenta.server";
import { aCentavos, redondear2 } from "@/lib/anticipos/core";
import {
  ESTADOS_DE_REVERSO,
  METODO_MERCADO_PAGO,
  VIGENCIA_DIAS,
  evaluarPagoDeFactura,
  linkReutilizable,
  linkVigente,
  motivoSinLink,
  refDeFactura,
  saldoPorCobrar,
  tituloDelCobro,
  type MotivoSinLink,
} from "./core";

type Db = typeof prisma;

export interface DepsFacturaMp {
  db: Db;
  plataformaLista: () => boolean;
  credencial: (clinicId: string) => Promise<CredencialDeCobro | null>;
  crearPreferencia: (token: string, opts: CreatePreferenceOptions) => Promise<CreatePreferenceResult>;
  expirarPreferencia: (token: string, preferenceId: string) => Promise<void>;
  consultarPago: (token: string, paymentId: string) => Promise<MercadoPagoPayment | null>;
  ahora: () => Date;
  baseUrl: () => string | null;
}

export const depsReales: DepsFacturaMp = {
  db: prisma,
  plataformaLista: () => plataformaAnticipos().lista,
  credencial: (clinicId) => credencialDeCobro(clinicId),
  crearPreferencia: createPreference,
  expirarPreferencia: (token, id) => expirePreference(token, id),
  // 401/403 LANZA: con un token de OAuth significa «el token ya no sirve», no
  // «el pago no existe». Tragarlo con un 200 perdería el pago.
  consultarPago: (token, paymentId) => getPayment(token, paymentId, { throwOnAuthError: true }),
  ahora: () => new Date(),
  baseUrl: urlBaseApp,
};

function deps(over?: Partial<DepsFacturaMp>): DepsFacturaMp {
  return over ? { ...depsReales, ...over } : depsReales;
}

/** Tabla o columna que todavía no existe (el SQL va por detrás del deploy). */
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

const DIA_MS = 24 * 60 * 60 * 1000;

// ── 1. ¿Se ofrece? ──────────────────────────────────────────────────────────

/**
 * ¿Esta clínica puede cobrar facturas con Mercado Pago? Solo si DaleControl ya
 * puede conectar cuentas (las variables de la plataforma), la clínica tiene una
 * cuenta conectada con token, y la tabla de links existe. Si no, el método NI
 * SE ENSEÑA: nada de un botón que da error.
 *
 * No lee el token: pregunta si existe. `depositEnabled` (el anticipo del bot)
 * no importa aquí: cobrar una factura no depende de pedir anticipos.
 */
export async function cobroMpDisponible(clinicId: string, over?: Partial<DepsFacturaMp>): Promise<boolean> {
  const d = deps(over);
  if (!clinicId || !d.plataformaLista() || !d.baseUrl()) return false;
  try {
    const cuenta = await d.db.clinicMercadoPago.findFirst({
      where: { clinicId, accessToken: { not: null }, mpUserId: { not: null } },
      select: { clinicId: true },
    });
    if (!cuenta) return false;
    // Sin el SQL de esta rama no hay dónde guardar el link: tampoco se ofrece.
    await d.db.invoicePaymentLink.findFirst({ where: { clinicId }, select: { id: true } });
    return true;
  } catch (e) {
    if (faltaTabla(e)) return false;
    throw e;
  }
}

// ── 2. El link ──────────────────────────────────────────────────────────────

export type ErrorLink = "sin_mp" | "no_encontrada" | MotivoSinLink | "mp_fallo";

export interface LinkDeFactura {
  url: string;
  monto: number;
  venceA: string;
}

/** Un solo tipo, sin unión: el repo no compila en `strict` y no estrecha por `ok`. */
export interface ResultadoLink {
  ok: boolean;
  error: ErrorLink | null;
  link: LinkDeFactura | null;
  /** true = era el link que ya existía (mismo saldo, vigente). */
  reutilizado: boolean;
}

/** El motivo, en palabras para la pantalla. */
export const TEXTO_ERROR_LINK: Record<ErrorLink, string> = {
  sin_mp: "Esta clínica no tiene Mercado Pago conectado. Conéctalo en Configuración → Anticipos.",
  no_encontrada: "Factura no encontrada.",
  estado: "Solo se puede cobrar con link una factura emitida con saldo (pendiente, parcial o vencida).",
  sin_saldo: "La factura ya no tiene saldo por cobrar.",
  bajo_minimo: "El saldo es menor al mínimo para cobrar en línea ($10 MXN).",
  mp_fallo: "Mercado Pago no pudo generar el link. Intenta de nuevo en unos minutos.",
};

function fallo(error: ErrorLink): ResultadoLink {
  return { ok: false, error, link: null, reutilizado: false };
}

/**
 * El link con el que el paciente paga el SALDO de la factura.
 *
 * · El monto lo decide el servidor: total − pagado de la factura, leído aquí,
 *   bajo candado. El cliente no manda montos (ni se le pregunta).
 * · Cobra la cuenta de la clínica; `marketplace_fee` 0: DaleControl no cobra
 *   comisión por cobrar una factura.
 * · Reutiliza el link PENDING si pide exactamente el saldo de hoy, lo cobra la
 *   cuenta de hoy y le queda al menos un día. Si no, hace otro y los viejos
 *   quedan REPLACED (y se cierran en MP, sin que eso pueda tumbar esto).
 * · Dos peticiones a la vez para la misma factura se forman
 *   (`pg_advisory_xact_lock` por factura): sale UN link, no dos. Es un candado
 *   aparte del FOR UPDATE de la factura a propósito: mientras MP contesta no se
 *   bloquea a quien está registrando un pago en caja.
 */
export async function obtenerLinkDeFactura(
  args: { clinicId: string; invoiceId: string; userId?: string | null },
  over?: Partial<DepsFacturaMp>,
): Promise<ResultadoLink> {
  const d = deps(over);
  const { clinicId, invoiceId } = args;
  // clinicId vacío no filtra nada (Prisma descarta la clave): se corta antes.
  if (!clinicId || !invoiceId) return fallo("no_encontrada");
  if (!(await cobroMpDisponible(clinicId, d))) return fallo("sin_mp");
  const base = d.baseUrl();
  const cred = await d.credencial(clinicId);
  if (!cred || !base) return fallo("sin_mp");

  let viejos: { mpPreferenceId: string | null }[] = [];
  let resultado: ResultadoLink;
  try {
    resultado = await d.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factura-mp:${invoiceId}`}))`;

        const inv = await tx.invoice.findFirst({
          where: { id: invoiceId, clinicId },
          select: { id: true, invoiceNumber: true, status: true, total: true, paid: true, clinic: { select: { name: true } } },
        });
        if (!inv) return fallo("no_encontrada");
        const motivo = motivoSinLink(inv);
        if (motivo) return fallo(motivo);
        const saldo = saldoPorCobrar(inv);
        const ahora = d.ahora();

        const pendientes = await tx.invoicePaymentLink.findMany({
          where: { invoiceId, clinicId, status: "PENDING" },
          orderBy: { createdAt: "desc" },
          select: { id: true, amount: true, status: true, expiresAt: true, checkoutUrl: true, mpCollectorId: true, mpPreferenceId: true },
        });
        const bueno = pendientes.find((l) => linkReutilizable(l, saldo, cred.mpUserId, ahora));
        if (bueno) {
          return {
            ok: true,
            error: null,
            link: { url: bueno.checkoutUrl as string, monto: redondear2(bueno.amount), venceA: bueno.expiresAt.toISOString() },
            reutilizado: true,
          };
        }

        const vence = new Date(ahora.getTime() + VIGENCIA_DIAS * DIA_MS);
        const fila = await tx.invoicePaymentLink.create({
          data: {
            clinicId,
            invoiceId,
            amount: saldo,
            status: "PENDING",
            expiresAt: vence,
            mpCollectorId: cred.mpUserId,
            createdById: args.userId ?? null,
          },
          select: { id: true },
        });
        const ref = refDeFactura(fila.id);
        const vuelta = `${base}/pago/factura`;
        // Si MP falla, esto LANZA y la transacción se deshace: no queda una fila
        // PENDING sin link.
        const pref = await d.crearPreferencia(cred.accessToken, {
          items: [{ title: tituloDelCobro(inv.invoiceNumber, inv.clinic?.name), quantity: 1, unit_price: saldo }],
          externalReference: ref,
          notificationUrl: `${base}/api/webhooks/mercadopago?ref=${encodeURIComponent(ref)}`,
          backUrls: { success: vuelta, failure: vuelta, pending: vuelta },
          // Explícito: el dinero de una factura es de la clínica, sin comisión.
          marketplaceFee: 0,
          expiresAt: vence,
        });
        if (!pref?.id || !pref?.initPoint) throw new Error("Mercado Pago no devolvió el link");
        await tx.invoicePaymentLink.update({
          where: { id: fila.id },
          data: { mpPreferenceId: pref.id, checkoutUrl: pref.initPoint },
        });
        if (pendientes.length > 0) {
          await tx.invoicePaymentLink.updateMany({
            where: { invoiceId, clinicId, status: "PENDING", id: { not: fila.id } },
            data: { status: "REPLACED" },
          });
          viejos = pendientes;
        }
        return {
          ok: true,
          error: null,
          link: { url: pref.initPoint, monto: saldo, venceA: vence.toISOString() },
          reutilizado: false,
        };
      },
      { timeout: 20_000 },
    );
  } catch (e) {
    if (faltaTabla(e)) return fallo("sin_mp");
    console.error(`[factura-mp] no se pudo generar el link (factura ${invoiceId}): ${(e as Error).message}`);
    return fallo("mp_fallo");
  }

  // Los links viejos dejan de aceptar pagos. Best-effort: si MP no contesta, el
  // viejo sigue vivo hasta su fecha, y si alguien lo paga el webhook lo registra
  // igual (marcado si sobra). El dinero nunca se pierde.
  for (const v of viejos) {
    if (!v.mpPreferenceId) continue;
    try {
      await d.expirarPreferencia(cred.accessToken, v.mpPreferenceId);
    } catch (e) {
      console.error(`[factura-mp] no se pudo cerrar la preferencia vieja ${v.mpPreferenceId}: ${(e as Error).message}`);
    }
  }
  return resultado;
}

export interface EstadoLink {
  disponible: boolean;
  /**
   * El link PENDING vigente más reciente, SOLO si pide exactamente el saldo de
   * hoy. Uno por un saldo viejo (cobraron una parte en caja, descuento…) no se
   * enseña: copiarlo le cobraría de más al paciente.
   */
  link: LinkDeFactura | null;
  /** La factura tuvo un link pendiente (aunque ya no sirva): se cobra por Mercado Pago. */
  habiaLink: boolean;
  /** Saldo que pediría un link nuevo. */
  saldo: number;
  /** Por qué no se puede hacer link (null = sí se puede). */
  motivo: ErrorLink | null;
}

/** Lo que el detalle de la factura enseña. Solo lee: no crea nada en MP. */
export async function estadoDelLink(
  args: { clinicId: string; invoiceId: string },
  over?: Partial<DepsFacturaMp>,
): Promise<EstadoLink> {
  const d = deps(over);
  const vacio: EstadoLink = { disponible: false, link: null, habiaLink: false, saldo: 0, motivo: "sin_mp" };
  if (!args.clinicId || !args.invoiceId) return { ...vacio, motivo: "no_encontrada" };
  if (!(await cobroMpDisponible(args.clinicId, d))) return vacio;
  const inv = await d.db.invoice.findFirst({
    where: { id: args.invoiceId, clinicId: args.clinicId },
    select: { status: true, total: true, paid: true },
  });
  if (!inv) return { disponible: true, link: null, habiaLink: false, saldo: 0, motivo: "no_encontrada" };
  const saldo = saldoPorCobrar(inv);
  const motivo = motivoSinLink(inv);
  const ahora = d.ahora();
  const ultimo = motivo
    ? null
    : await d.db.invoicePaymentLink.findFirst({
        where: { invoiceId: args.invoiceId, clinicId: args.clinicId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        select: { amount: true, status: true, expiresAt: true, checkoutUrl: true },
      });
  const link =
    ultimo && ultimo.checkoutUrl && linkVigente(ultimo, ahora) && aCentavos(ultimo.amount) === aCentavos(saldo)
      ? { url: ultimo.checkoutUrl, monto: redondear2(ultimo.amount), venceA: ultimo.expiresAt.toISOString() }
      : null;
  return { disponible: true, link, habiaLink: !!ultimo, saldo, motivo };
}

/**
 * El saldo de la factura cambió por otro lado (cobro en caja, marcar pagada,
 * cancelar, editar precio, reembolso): los links PENDING piden un monto que ya
 * no es, así que quedan REPLACED y se cierran en Mercado Pago para que nadie
 * pague un saldo viejo. Si hace falta, el siguiente «ver link» hace otro por el
 * saldo nuevo.
 *
 * NUNCA lanza ni tumba al que llama: el cobro ya quedó. Si MP no contesta, el
 * link viejo vive hasta su fecha y, si alguien lo paga, el webhook lo registra
 * marcado (excedente / ya saldada). Sin el SQL de la rama no hay nada que cerrar.
 */
export async function cerrarLinksDeFactura(
  args: { clinicId: string; invoiceId: string },
  over?: Partial<DepsFacturaMp>,
): Promise<number> {
  const d = deps(over);
  const { clinicId, invoiceId } = args;
  if (!clinicId || !invoiceId) return 0;
  try {
    // El MISMO candado que `obtenerLinkDeFactura`: si justo ahora se está creando
    // un link con el saldo de antes del cobro, esto espera a que termine y lo
    // cierra también. Y si esto va primero, el link que se pida después ya lee el
    // saldo nuevo (el cobro que nos llama ya hizo commit).
    const abiertos = await d.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factura-mp:${invoiceId}`}))`;
      const filas = await tx.invoicePaymentLink.findMany({
        where: { invoiceId, clinicId, status: "PENDING" },
        select: { id: true, mpPreferenceId: true },
      });
      if (filas.length > 0) {
        await tx.invoicePaymentLink.updateMany({
          where: { invoiceId, clinicId, status: "PENDING", id: { in: filas.map((l) => l.id) } },
          data: { status: "REPLACED" },
        });
      }
      return filas;
    });
    if (abiertos.length === 0) return 0;
    const cred = await d.credencial(clinicId);
    for (const l of abiertos) {
      if (!cred || !l.mpPreferenceId) continue;
      try {
        await d.expirarPreferencia(cred.accessToken, l.mpPreferenceId);
      } catch (e) {
        console.error(`[factura-mp] no se pudo cerrar la preferencia ${l.mpPreferenceId}: ${(e as Error).message}`);
      }
    }
    return abiertos.length;
  } catch (e) {
    if (!faltaTabla(e)) console.error(`[factura-mp] no se pudieron cerrar los links de ${invoiceId}: ${(e as Error).message}`);
    return 0;
  }
}

// ── 3. El webhook ───────────────────────────────────────────────────────────

/** Un solo tipo, sin unión (ver ResultadoLink). */
export interface ResultadoPagoFactura {
  aplicado: boolean;
  motivo: string | null;
  invoiceId: string | null;
  patientId: string | null;
  monto: number;
  /** null = pago normal. Texto = el Payment quedó marcado para revisar/devolver. */
  anomalia: string | null;
}

function noAplicado(motivo: string): ResultadoPagoFactura {
  return { aplicado: false, motivo, invoiceId: null, patientId: null, monto: 0, anomalia: null };
}

/**
 * Registra un pago de Mercado Pago en su factura. IDEMPOTENTE: MP reintenta y
 * el mismo pago puede llegar N veces; solo la primera crea el Payment.
 *
 * Contrato con el webhook (el mismo que el anticipo):
 *   · Devuelve (→ 200) en lo DETERMINISTA: link inexistente, pago que MP no
 *     encuentra, de otro link, no aprobado, duplicado.
 *   · LANZA (→ 500, MP reintenta) en lo TRANSITORIO: red o 5xx de MP, token que
 *     MP rechaza, base caída, o la clínica sin cuenta (un pago que puede ser
 *     real no se descarta: si la reconecta, el reintento lo aplica).
 *
 * Idempotencia, como recharge.ts y online-payment.ts: dentro de una transacción
 * con `FOR UPDATE` sobre la FACTURA se busca un Payment previo con la misma
 * referencia (el id del pago de MP) antes de crear nada. El candado es el mismo
 * que toman el cobro manual y el pago del portal, así que tampoco se pisa con
 * un cobro en caja que llegue a la vez.
 *
 * Seguridad: del cuerpo del webhook solo se usa el id del pago para
 * PREGUNTARLE a Mercado Pago —con el token de la clínica— qué pasó.
 */
export async function aplicarPagoDeFactura(
  linkId: string,
  paymentId: string,
  over?: Partial<DepsFacturaMp>,
): Promise<ResultadoPagoFactura> {
  const d = deps(over);
  if (!linkId || !paymentId) return noAplicado("faltan datos");

  const link = await d.db.invoicePaymentLink.findUnique({
    where: { id: linkId },
    select: { id: true, clinicId: true, invoiceId: true, mpCollectorId: true, status: true },
  });
  if (!link) return noAplicado("link inexistente");

  const cred = await d.credencial(link.clinicId);
  if (!cred) {
    console.error(`[factura-mp] pago ${paymentId} del link ${linkId}: la clínica no tiene cuenta de MP conectada; MP reintentará`);
    throw new Error("clínica sin cuenta de Mercado Pago para verificar el pago");
  }
  if (link.mpCollectorId && cred.mpUserId !== link.mpCollectorId) {
    // Cambió de cuenta después de mandar el link: con el token nuevo el pago no
    // se ve. Se anota y se LANZA para que MP reintente (igual que el anticipo).
    await d.db.invoicePaymentLink.updateMany({
      where: { id: linkId, status: "PENDING" },
      data: { lastMpStatus: "otra_cuenta", lastMpStatusDetail: `pago ${paymentId}` },
    });
    console.error(`[factura-mp] pago ${paymentId} del link ${linkId}: la clínica conectó OTRA cuenta de MP; MP reintentará`);
    throw new Error("la clínica conectó otra cuenta de Mercado Pago: el pago no se puede verificar");
  }

  const pago = await d.consultarPago(cred.accessToken, paymentId);
  if (!pago) return noAplicado("Mercado Pago no encuentra el pago");

  const decision = evaluarPagoDeFactura(link, pago);
  if (decision.accion === "ignorar") {
    console.error(`[factura-mp] pago ${paymentId} ignorado para el link ${linkId}: ${decision.motivo}`);
    return noAplicado(decision.motivo);
  }
  if (decision.accion === "anotar_estado") {
    await d.db.invoicePaymentLink.updateMany({
      where: { id: linkId, status: "PENDING" },
      data: { lastMpStatus: decision.estado, lastMpStatusDetail: decision.detalle },
    });
    // Un pago YA registrado que MP ahora reporta devuelto o contracargado: la
    // factura no se toca sola (mover dinero a ciegas es peor), pero el Payment
    // queda marcado para que la clínica lo revise.
    if (ESTADOS_DE_REVERSO.includes(decision.estado)) {
      const registrado = await d.db.payment.findFirst({
        where: { invoiceId: link.invoiceId, method: METODO_MERCADO_PAGO, reference: pago.id },
        select: { id: true, notes: true },
      });
      const nota = `⚠️ Mercado Pago reporta este pago como «${decision.estado}»: la factura NO se ajustó sola, revisarlo.`;
      if (registrado && !(registrado.notes ?? "").includes(nota)) {
        await d.db.payment.update({
          where: { id: registrado.id },
          data: { notes: registrado.notes ? `${registrado.notes} · ${nota}` : nota },
        });
        console.error(`[factura-mp] pago ${pago.id} (link ${linkId}) reportado como ${decision.estado}: revisar la factura`);
      }
    }
    return noAplicado(`pago ${decision.estado}`);
  }

  const ahora = d.ahora();
  const aprobado = pago.dateApproved ? new Date(pago.dateApproved) : null;
  // Cuándo ENTRÓ el dinero, nunca en el futuro (el reloj de MP y el nuestro).
  const pagadoEl =
    aprobado && !isNaN(aprobado.getTime()) && aprobado.getTime() <= ahora.getTime() ? aprobado : ahora;
  const monto = decision.monto;

  return d.db.$transaction(async (tx) => {
    // El candado de la factura: el mismo del cobro manual (POST /api/invoices/[id]),
    // de mark-paid y del pago del portal.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${link.invoiceId} FOR UPDATE`;

    const ya = await tx.payment.findFirst({
      where: { invoiceId: link.invoiceId, method: METODO_MERCADO_PAGO, reference: pago.id },
      select: { id: true, notes: true },
    });
    if (ya) {
      // Reembolso PARCIAL: MP deja el pago `approved` con lo devuelto aparte. La
      // factura no se toca sola, pero el Payment queda anotado (una vez por monto).
      const devuelto = redondear2(pago.transactionAmountRefunded ?? 0);
      if (devuelto > 0) {
        const nota = `⚠️ Mercado Pago reporta $${devuelto.toFixed(2)} devueltos de este pago: la factura NO se ajustó sola, revisarlo.`;
        if (!(ya.notes ?? "").includes(nota)) {
          await tx.payment.update({ where: { id: ya.id }, data: { notes: ya.notes ? `${ya.notes} · ${nota}` : nota } });
          console.error(`[factura-mp] pago ${pago.id} (link ${linkId}) con reembolso parcial de $${devuelto.toFixed(2)}: revisar la factura`);
        }
      }
      return noAplicado("pago ya aplicado");
    }

    const inv = await tx.invoice.findFirst({
      where: { id: link.invoiceId, clinicId: link.clinicId },
      select: { id: true, total: true, paid: true, status: true, patientId: true },
    });
    if (!inv) return noAplicado("factura inexistente");

    // «Ya saldada» por el invariante total − paid, no por la columna balance.
    const pendiente = saldoPorCobrar(inv);
    const anomaliaFactura =
      inv.status === "CANCELLED" ? "factura cancelada" : pendiente <= 0 ? "factura ya saldada" : null;

    let anomalia: string | null = null;
    if (anomaliaFactura) {
      // El dinero YA entró: se registra el Payment, pero la factura no cambia y
      // el pago queda señalado para devolverlo (criterio de online-payment.ts).
      anomalia = `Pago de Mercado Pago recibido sobre ${anomaliaFactura} — revisar/devolver`;
      await tx.payment.create({
        data: {
          invoiceId: inv.id,
          amount: monto,
          method: METODO_MERCADO_PAGO,
          reference: pago.id,
          paidAt: pagadoEl,
          notes: `⚠️ ${anomalia}`,
        },
      });
    } else {
      const nuevoPagado = redondear2(inv.paid + monto);
      const nuevoSaldo = redondear2(Math.max(0, inv.total - nuevoPagado));
      const saldada = nuevoSaldo <= 0;
      // Pagó MÁS de lo que quedaba (la recepción cobró una parte en caja con el
      // link ya enviado): entra tal cual —paid > total es la verdad— y se marca.
      const excedente = redondear2(nuevoPagado - inv.total);
      if (excedente > 0) anomalia = `Pago de Mercado Pago con excedente de $${excedente.toFixed(2)} sobre el saldo — revisar/devolver`;
      await tx.payment.create({
        data: {
          invoiceId: inv.id,
          amount: monto,
          method: METODO_MERCADO_PAGO,
          reference: pago.id,
          paidAt: pagadoEl,
          notes: anomalia ? `⚠️ ${anomalia}` : "Pago en línea con Mercado Pago",
        },
      });
      await tx.invoice.updateMany({
        where: { id: inv.id, clinicId: link.clinicId },
        data: {
          paid: nuevoPagado,
          balance: nuevoSaldo,
          status: saldada ? "PAID" : "PARTIAL",
          paymentMethod: METODO_MERCADO_PAGO,
          ...(saldada ? { paidAt: pagadoEl } : {}),
        },
      });
    }

    // El link: el primer pago aprobado lo deja PAID (uno REPLACED también: entró
    // dinero por él). Un segundo pago por el mismo link no pisa al primero.
    await tx.invoicePaymentLink.updateMany({
      where: { id: link.id, mpPaymentId: null },
      data: {
        status: "PAID",
        mpPaymentId: pago.id,
        paidAmount: monto,
        paidAt: pagadoEl,
        lastMpStatus: pago.status,
        lastMpStatusDetail: pago.statusDetail,
      },
    });

    if (anomalia) console.error(`[factura-mp] pago ${pago.id} (factura ${inv.id}): ${anomalia}`);
    return { aplicado: true, motivo: null, invoiceId: inv.id, patientId: inv.patientId, monto, anomalia };
  });
}
