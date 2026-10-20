/**
 * «Pagar mi plan» y «Subir de plan y pagar» — lo que habla con Stripe.
 *
 * Todo lo de fuera entra por `DepsPago` (Stripe, la clínica de la SESIÓN, los precios de `plan_configs`,
 * el IVA, las sedes, la bitácora y el cambio local de plan): la ruta `/api/billing/pago-pendiente` los
 * cablea con prisma y `getStripeSafe()`, y las pruebas con dobles, sin base ni red.
 *
 * NUNCA se borra nada: la factura vieja se ANULA (void) en Stripe y queda ahí. La reactivación de la clínica
 * la hace el webhook existente (invoice.paid / customer.subscription.updated); aquí no se escribe
 * `subscriptionStatus`.
 */

import { randomUUID } from "node:crypto";
import { isClinicBillingAdmin } from "./authz";
import { clinicaEstabaSuspendida, finDeLoPagado } from "./cobro-rechazado";
import {
  aplicarReglaDeSuspension,
  anularFacturasDeMesesSuspendidos,
  facturasAbiertasDelPlan,
  type StripeParaSuspension,
} from "./reactivacion-tras-suspension.server";
import { FALLO_LECTURA_REGLA, avisoFalloReglaSuspension, avisoSubidaSinCobro, avisoCobroMenorQueLoMostrado, avisoReposicionSinVerificar, avisoCuponConFinRepuesto, avisoCuponNoRepuesto, avisoCuponNoRepuestoPorCambio } from "./avisos-admin";
import { desgloseConIva, ivaAplica, ivaParaPagoDeClinica, type ExencionIva, type IvaParaCobro } from "./iva-cobro";
import type { PlanId } from "./plans";
import {
  buildTargetPriceParams,
  chargeFailureMessage,
  isLiveSubscriptionStatus,
  isStripeChargeFailure,
  planAmountCents,
  subscriptionItemInterval,
  type BillingInterval,
  type PlanPricing,
} from "./proration";
import {
  MENSAJES,
  MONEDA_PAGO,
  anuladaRecuperable,
  MARCA,
  armarMarca,
  claves,
  descuentosParaSubir,
  esErrorDeIdempotencia,
  idsDeDescuentos,
  idsDePromo,
  esPlanMasGrande,
  facturaAbiertaMasReciente,
  facturaTienePromo,
  planesMasGrandes,
  segundosDe,
  respuesta,
  type AnuladaRecuperable,
  type FacturaPago,
  type RespuestaPago,
  type SuscripcionPago,
} from "./pago-pendiente";

// ── Lo que se usa de Stripe (el cliente real lo cumple; las pruebas lo doblan) ──

export interface StripePago {
  subscriptions: {
    retrieve(id: string, params?: Record<string, unknown>): Promise<SuscripcionPago>;
    update(id: string, params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<SuscripcionPago & { latest_invoice?: string | FacturaPago | null }>;
  };
  invoices: {
    list(params: Record<string, unknown>): Promise<{ data: FacturaPago[] }>;
    retrieve(id: string): Promise<FacturaPago>;
    update(id: string, params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<FacturaPago>;
    pay(id: string, params?: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<FacturaPago>;
    voidInvoice(id: string, params?: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<FacturaPago>;
  };
  prices: {
    create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }>;
  };
  customers: {
    /** Quita el cupón puesto en el CLIENTE (DELETE /v1/customers/:id/discount). */
    deleteDiscount(id: string, params?: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<unknown>;
    /** Vuelve a poner un cupón / código promocional al cliente (`coupon` o `promotion_code`). */
    update(id: string, params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<unknown>;
  };
}

export interface ClinicaPago {
  id: string;
  /** Nombre de la clínica (solo para el aviso al admin). */
  nombre?: string | null;
  /** Estado de cobro de la clínica y hasta cuándo tiene acceso: deciden si estaba SUSPENDIDA al pagar. */
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
  plan: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface DepsPago {
  /** `null` = Stripe no está configurado en este entorno. */
  stripe: StripePago | null;
  /** Rol del usuario de la SESIÓN. */
  role: string | null | undefined;
  /** La clínica de la SESIÓN (nunca del body). */
  clinica: ClinicaPago;
  env: Record<string, string | undefined>;
  /** Plan con precio de lista (`plan_configs`), sin promo ni precios conservados de la clínica. */
  plan: (id: PlanId) => Promise<PlanPricing & { id: PlanId }>;
  /** Mensaje si las sedes impiden ese plan (`bloqueoDeSedesParaPlan`), o null. */
  bloqueoDeSedes: (id: PlanId) => Promise<string | null>;
  /** Sede incluida (no paga ni tiene plan propio) → nombre de quien paga; null si la clínica paga ella. */
  sedeIncluida: () => Promise<{ pagadoraId: string; pagadoraNombre: string | null } | null>;
  /** Exención de IVA de la clínica (`exencionIvaDeClinica`). */
  exencionIva: () => Promise<ExencionIva | null>;
  /** Escribe el plan nuevo en la clínica (plan, tope de IA, condiciones viejas fuera, sedes). Sin tocar el status. */
  aplicarPlanLocal: (plan: PlanId) => Promise<void>;
  /** Una fila en la bitácora de la clínica por acción. */
  auditar: (evento: Record<string, unknown>) => Promise<void>;
  /**
   * Candado por clínica para que dos peticiones de «subir» no corran a la vez (dos pestañas). Caduca solo
   * (`ttlSec`): si el proceso muere con él tomado no queda pegado. En producción: `acquireLock`/`releaseLock`
   * de failban (Upstash, o memoria de la instancia). Ante un fallo de infraestructura abre (deja pasar).
   */
  candado: {
    tomar: (clave: string, ttlSec: number, dueno: string) => Promise<boolean>;
    /** Suelta SOLO si el candado sigue siendo de `dueno` (si caducó y lo tomó otra petición, no toca el de ella). */
    soltar: (clave: string, dueno: string) => Promise<void>;
  };
  /** Aviso a quien administra la plataforma (correo); no debe lanzar. Sirve para lo que hay que hacer a mano. */
  avisarAlAdmin: (aviso: { asunto: string; lineas: string[] }) => Promise<void>;
  /** Mensaje cuando una sede incluida intenta pagar (`avisoSedeIncluida`). */
  avisoSedeIncluida: (pagadoraNombre: string | null) => string;
}

// ── Lo que lleva IVA (el ÚNICO archivo de esta función que conoce iva-cobro) ──

export interface OpcionSubir {
  plan: PlanId;
  nombre: string;
  /** Pesos, exactos: lo que se cobra HOY por el plan nuevo completo (con IVA si `ivaIncluido`). */
  monto: number;
  ivaIncluido: boolean;
}

/**
 * Lo que costaría el plan nuevo hoy: precio de lista del plan en el intervalo de la suscripción
 * (nunca la promo del primer mes, ni cupones, ni los precios conservados de la clínica: al subir se quitan
 * todos los descuentos, decisión de Rafael) más el IVA que corresponde. Es lo que Stripe va a cobrar.
 */
export function opcionDeSubida(args: {
  plan: PlanPricing & { id: PlanId };
  interval: BillingInterval;
  exencion: ExencionIva | null | undefined;
}): OpcionSubir {
  const subtotalCents = planAmountCents(args.plan, args.interval);
  const conIva = ivaAplica({ metodo: "card", plan: args.plan.id, exencion: args.exencion });
  const totalCents = conIva ? desgloseConIva(subtotalCents).totalCents : subtotalCents;
  return { plan: args.plan.id, nombre: args.plan.name, monto: totalCents / 100, ivaIncluido: conIva };
}

type IvaOk = Extract<IvaParaCobro, { ok: true }>;

export interface ParamsSubir {
  items: Array<{ id: string; price: string } & IvaOk["linea"]>;
  proration_behavior: "none";
  billing_cycle_anchor: "now";
  metadata: Record<string, string>;
  expand: string[];
  automatic_tax?: NonNullable<IvaOk["sesion"]["automatic_tax"]>;
  /** `""` = quita todos los descuentos de la suscripción (al subir se paga el precio normal). */
  discounts?: "";
}

/**
 * Arma el `subscriptions.update` de «subir». INVARIANTES (los fija la prueba):
 *   · `billing_cycle_anchor: "now"` + `proration_behavior: "none"`: ciclo nuevo desde hoy, plan nuevo
 *     COMPLETO, sin prorrateo ni crédito del viejo.
 *   · SIN `payment_behavior: "error_if_incomplete"`: la factura vieja ya está anulada; si la tarjeta
 *     vuelve a fallar la actualización debe quedar hecha y la factura nueva abierta (para pagarla por
 *     la URL), no revertida dejando a la clínica sin ninguna factura que pagar.
 *   · el plan va en la metadata de la suscripción (convención de change-plan: el webhook la usa).
 *   · el IVA lo ponen EXCLUSIVAMENTE los trozos que devuelve `ivaParaPagoDeClinica` (`linea` en el item,
 *     `sesion.automatic_tax` si es Stripe Tax): aquí no se escribe ninguna tasa a mano.
 */
export function armarUpdateSubir(args: {
  sub: SuscripcionPago;
  itemId: string;
  priceId: string;
  plan: PlanId;
  clinicId: string;
  iva: IvaOk;
}): ParamsSubir {
  const descuentos = descuentosParaSubir(args.sub);
  return {
    items: [{ id: args.itemId, price: args.priceId, ...args.iva.linea }],
    proration_behavior: "none",
    billing_cycle_anchor: "now",
    metadata: { ...(args.sub.metadata ?? {}), clinicId: args.clinicId, plan: args.plan, kind: "platform-subscription" },
    expand: ["latest_invoice"],
    ...(args.iva.sesion.automatic_tax ? { automatic_tax: args.iva.sesion.automatic_tax } : {}),
    ...(descuentos !== undefined ? { discounts: descuentos } : {}),
  };
}

// ── Utilidades ──────────────────────────────────────────────────────────────

/** El cliente de Stripe de la suscripción, si vino expandido (con su descuento). */
const clienteDe = (sub: SuscripcionPago) => (sub.customer && typeof sub.customer === "object" ? sub.customer : null);

type DescuentoDelCliente = NonNullable<NonNullable<ReturnType<typeof clienteDe>>["discount"]>;

type QuitadoDelCliente =
  | { estado: "sin" } // el cliente no tiene cupón (o no es el de esta clínica: no se toca)
  | { estado: "quitado"; clienteId: string; descuento: DescuentoDelCliente }
  | { estado: "fallo"; err: unknown };

/**
 * Quita el cupón puesto en el CLIENTE de Stripe (`customers.deleteDiscount`). Solo toca el cliente de Stripe de
 * ESTA clínica. DELETE es idempotente por definición (Stripe ignora la clave en DELETE): si otro POST ya lo
 * quitó, Stripe responde «no tiene descuento» (resource_missing) y cuenta como quitado por el otro (`sin`).
 * Deja en la bitácora QUÉ cupón era (cupón y código promocional) para poder reponerlo.
 */
async function quitarDescuentoDelCliente(deps: DepsPago, stripe: StripePago, sub: SuscripcionPago, destino: PlanId): Promise<QuitadoDelCliente> {
  const cliente = clienteDe(sub);
  const descuento = cliente?.discount;
  if (!cliente || !descuento) return { estado: "sin" };
  if (!deps.clinica.stripeCustomerId || cliente.id !== deps.clinica.stripeCustomerId) {
    await deps.auditar({ event: "pago-pendiente-descuento-cliente-ajeno", clienteSuscripcion: cliente.id });
    return { estado: "sin" };
  }
  try {
    await stripe.customers.deleteDiscount(cliente.id, {}, { idempotencyKey: claves.quitarDescuentoCliente(deps.clinica.id, descuento.id) });
  } catch (err) {
    if (codigoDe(err) === "resource_missing") return { estado: "sin" };
    return { estado: "fallo", err };
  }
  await deps.auditar({
    event: "pago-pendiente-descuento-cliente-quitado",
    descuentoId: descuento.id,
    cupon: descuento.coupon?.id ?? null,
    codigoPromocional: idDeCodigoPromocional(descuento),
    // Si el cupón tenía duración, su fecha de fin original (para ajustarla si hubiera que reponerlo).
    finOriginal: descuento.end ? new Date(descuento.end * 1000).toISOString() : null,
    planDestino: destino,
  });
  return { estado: "quitado", clienteId: cliente.id, descuento };
}

/**
 * NO se repone el cupón porque otra petición está haciendo (o ya hizo) el cambio: dejarlo puesto sobre un plan
 * ya subido iría contra la decisión de Rafael (precio de lista sin cupones). Queda en la bitácora y se avisa al
 * admin para que revise cómo quedó. Nunca lanza.
 */
async function noReponerPorOtroCambio(deps: DepsPago, q: Extract<QuitadoDelCliente, { estado: "quitado" }>, destino: PlanId, razon: "idempotencia" | "plan-ya-en-destino", motivo: string): Promise<void> {
  const promo = idDeCodigoPromocional(q.descuento);
  const cupon = q.descuento.coupon?.id ?? null;
  await deps
    .auditar({
      event: "pago-pendiente-descuento-cliente-no-repuesto-otro-cambio",
      clienteStripe: q.clienteId,
      descuentoQuitado: q.descuento.id,
      cupon,
      codigoPromocional: promo,
      razon,
      motivo,
      planDestino: destino,
    })
    .catch(() => {});
  await deps
    .avisarAlAdmin(avisoCuponNoRepuestoPorCambio({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, clienteStripe: q.clienteId, cupon, codigoPromocional: promo, razon, planDestino: destino }))
    .catch(() => {});
}

const idDeCodigoPromocional = (d: DescuentoDelCliente): string | null =>
  typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code?.id ?? null;

/**
 * Vuelve a poner al cliente el MISMO cupón que se le quitó (su código promocional si tenía uno; si no, el
 * cupón), con clave de idempotencia por cliente+descuento. Se llama si algo falla DESPUÉS de quitarlo y ANTES
 * de que el cambio de plan quede hecho: así la clínica nunca se queda sin cupón y sin plan nuevo. Nunca lanza.
 * Si reponerlo también falla, queda en la bitácora con todo lo necesario y se avisa al admin por correo para
 * hacerlo a mano en Stripe.
 */
async function reponerDescuentoDelCliente(deps: DepsPago, stripe: StripePago, q: Extract<QuitadoDelCliente, { estado: "quitado" }>, destino: PlanId, motivo: string): Promise<boolean> {
  const promo = idDeCodigoPromocional(q.descuento);
  const cupon = q.descuento.coupon?.id ?? null;
  const params: Record<string, unknown> | null = promo ? { promotion_code: promo } : cupon ? { coupon: cupon } : null;
  let error: unknown = params ? null : new Error("sin cupón que reponer");
  if (params) {
    try {
      await stripe.customers.update(q.clienteId, params, { idempotencyKey: claves.reponerDescuentoCliente(deps.clinica.id, q.descuento.id) });
      const fin = q.descuento.end ?? null;
      await deps.auditar({
        event: "pago-pendiente-descuento-cliente-repuesto",
        descuentoId: q.descuento.id,
        cupon,
        codigoPromocional: promo,
        motivo,
        planDestino: destino,
        // Stripe cuenta el descuento repuesto desde hoy: si tenía fin, la duración se reinicia (hay que ajustarla a mano).
        ...(fin ? { finOriginal: new Date(fin * 1000).toISOString(), finPorAjustar: true } : {}),
      });
      if (fin) {
        await deps
          .avisarAlAdmin(avisoCuponConFinRepuesto({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, clienteStripe: q.clienteId, cupon, codigoPromocional: promo, finOriginal: fin }))
          .catch(() => {});
      }
      return true;
    } catch (err) {
      error = err;
    }
  }
  const e = error as { message?: string; type?: string } | null;
  const datos = { clienteStripe: q.clienteId, descuentoQuitado: q.descuento.id, cupon, codigoPromocional: promo };
  await deps
    .auditar({ event: "pago-pendiente-descuento-cliente-NO-repuesto", ...datos, motivo, planDestino: destino, code: codigoDe(error) ?? null, tipo: e?.type ?? null, mensajeStripe: e?.message ?? null })
    .catch(() => {});
  await deps
    .avisarAlAdmin(avisoCuponNoRepuesto({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, clienteStripe: q.clienteId, cupon, codigoPromocional: promo }))
    .catch(() => {});
  return false;
}

const codigoDe = (err: unknown): string | undefined => {
  const e = err as { code?: string; raw?: { code?: string } } | null;
  return e?.code ?? e?.raw?.code;
};

/**
 * 502 con un texto NUESTRO, en español: la clínica nunca ve el mensaje de Stripe (viene en inglés y es
 * técnico). Lo que dijo Stripe va solo a la bitácora, con el paso donde pasó.
 */
async function falloDeStripe(deps: DepsPago, paso: string, err: unknown): Promise<RespuestaPago> {
  const e = err as { message?: string; type?: string; statusCode?: number } | null;
  await deps
    .auditar({ event: "pago-pendiente-error-stripe", paso, code: codigoDe(err) ?? null, tipo: e?.type ?? null, status: e?.statusCode ?? null, mensajeStripe: e?.message ?? null })
    .catch(() => {});
  return respuesta(502, { code: "STRIPE_ERROR", error: MENSAJES.stripeNoContesto });
}

const resultadoDeFactura = (f: FacturaPago | null | undefined): RespuestaPago => {
  if (f?.status === "paid") return respuesta(200, { ok: true, pagado: true });
  if (f?.hosted_invoice_url) return respuesta(200, { ok: true, pagado: false, url: f.hosted_invoice_url });
  return respuesta(502, { code: "SIN_URL_DE_PAGO", error: MENSAJES.noHayUrl });
};

type Contexto =
  | { ok: false; respuesta: RespuestaPago }
  | {
      ok: true;
      stripe: StripePago;
      sub: SuscripcionPago;
      /** La factura abierta; null solo cuando hay un cambio de plan a medias (`anulada`). */
      factura: FacturaPago | null;
      /** Factura anulada por «subir» cuyo cambio no se completó (ver `anuladaRecuperable`). */
      anulada: AnuladaRecuperable | null;
    };

/**
 * Lo común de las tres operaciones: permiso, suscripción de tarjeta VIVA de la clínica de la sesión y su
 * factura abierta. Los códigos del contrato: 403 sin permiso · 409 sin pendiente · 502 Stripe no contestó.
 * `soloLectura` (GET): lo que no hay que pagar no es un error, es `sin_pendiente`.
 * `conRecuperacion` (GET y «subir»): sin factura abierta, busca la anulada por «subir» cuyo cambio quedó a
 * medias; si la hay, es un pendiente (hay que terminar el cambio) en vez de «sin pendiente».
 */
async function cargarPendiente(deps: DepsPago, soloLectura: boolean, conRecuperacion = false): Promise<Contexto | { ok: false; sinPendiente: true }> {
  const sinPendiente = soloLectura
    ? ({ ok: false, sinPendiente: true } as const)
    : ({ ok: false, respuesta: respuesta(409, { code: "SIN_PENDIENTE", error: MENSAJES.sinPendiente }) } as const);

  if (!isClinicBillingAdmin(deps.role)) {
    return { ok: false, respuesta: respuesta(403, { code: "FORBIDDEN_NOT_CLINIC_ADMIN", error: MENSAJES.sinPermiso }) };
  }
  const { clinica } = deps;
  if (!clinica.id) return { ok: false, respuesta: respuesta(401, { error: "Sin sesión de clínica" }) };

  const sede = await deps.sedeIncluida();
  if (sede) {
    return soloLectura
      ? { ok: false, sinPendiente: true }
      : {
          ok: false,
          respuesta: respuesta(409, { code: "SEDE_INCLUIDA", error: deps.avisoSedeIncluida(sede.pagadoraNombre), pagadoraId: sede.pagadoraId }),
        };
  }
  if (!clinica.stripeSubscriptionId) return sinPendiente;
  if (!deps.stripe) {
    return { ok: false, respuesta: respuesta(503, { code: "STRIPE_NO_CONFIGURADO", error: MENSAJES.pagosNoDisponibles }) };
  }
  const stripe = deps.stripe;

  let sub: SuscripcionPago;
  try {
    // `discounts` y `customer` expandidos: se registra qué cupones se quitan y si el cliente trae uno propio.
    sub = await stripe.subscriptions.retrieve(clinica.stripeSubscriptionId, { expand: ["items.data", "discounts", "customer"] });
  } catch (err) {
    if (codigoDe(err) === "resource_missing") return sinPendiente;
    return { ok: false, respuesta: await falloDeStripe(deps, "suscripcion", err) };
  }
  if (!isLiveSubscriptionStatus(sub.status)) return sinPendiente;

  let facturas: FacturaPago[];
  try {
    facturas = (await stripe.invoices.list({ subscription: clinica.stripeSubscriptionId, status: "open", limit: 10 })).data;
    // Sin ninguna abierta, una INCOBRABLE (la que Stripe deja al agotar los reintentos) también se cobra con
    // `invoices.pay`: «sin_pendiente» solo sale cuando de verdad no hay nada que cobrar.
    if (!facturaAbiertaMasReciente(facturas, clinica.stripeCustomerId)) {
      facturas = (await stripe.invoices.list({ subscription: clinica.stripeSubscriptionId, status: "uncollectible", limit: 10 })).data;
    }
  } catch (err) {
    return { ok: false, respuesta: await falloDeStripe(deps, "facturas", err) };
  }
  const factura = facturaAbiertaMasReciente(facturas, clinica.stripeCustomerId);
  if (factura) return { ok: true, stripe, sub, factura, anulada: null };
  if (!conRecuperacion) return sinPendiente;

  let anuladas: FacturaPago[];
  try {
    anuladas = (await stripe.invoices.list({ subscription: clinica.stripeSubscriptionId, status: "void", limit: 10 })).data;
  } catch (err) {
    return { ok: false, respuesta: await falloDeStripe(deps, "facturas-anuladas", err) };
  }
  const anulada = anuladaRecuperable({
    facturas: anuladas,
    customerId: clinica.stripeCustomerId,
    planSuscripcion: sub.metadata?.plan,
    planClinica: clinica.plan,
  });
  if (!anulada) return sinPendiente;
  return { ok: true, stripe, sub, factura: null, anulada };
}

// ── Regla de la suspensión (ws1-t1 af1a76cc) ───────────────────────────────

/**
 * Rafael: una clínica suspendida por falta de pago NO debe los meses que estuvo sin servicio; al volver a pagar se
 * le dan 30 días contados desde el día y la hora del pago. Dentro de las 24 h de gracia (aún con acceso) no hay
 * meses suspendidos y el ciclo no cambia. Estas dos funciones aplican la regla a los dos botones; ambas son
 * idempotentes (las claves de Stripe salen de la factura y del momento del pago, el mismo que usa el webhook
 * `invoice.paid`, así que si los dos corren a la vez no se duplica ni se salta nada) y NUNCA lanzan: la clínica ya
 * pagó. Si algo falla queda en la bitácora y se avisa al admin; el webhook y «Reintentar» lo completan.
 */
async function reglaTrasPagar(deps: DepsPago, stripe: StripePago, facturaPagada: FacturaPago): Promise<void> {
  const subId = deps.clinica.stripeSubscriptionId;
  if (!subId) return;
  const real = stripe as unknown as StripeParaSuspension;
  // El mismo instante de pago que usa el webhook (`status_transitions.paid_at`): mismas claves de idempotencia.
  const pagadoEn = facturaPagada.status_transitions?.paid_at ? new Date(facturaPagada.status_transitions.paid_at * 1000) : new Date();
  try {
    const viva = await real.subscriptions.retrieve(subId);
    const otras = (await facturasAbiertasDelPlan(real, subId)).filter((f) => f.id !== facturaPagada.id);
    // Se paga UN mes (la factura más reciente); los meses suspendidos se anulan y el ciclo pasa a «hoy + 30 días».
    const r = await aplicarReglaDeSuspension({ stripe: real, clinicId: deps.clinica.id, sub: viva, pagadoEn, finDeLoPagado: finDeLoPagado(pagadoEn, 1), facturas: otras });
    await deps.auditar({
      event: "pago-pendiente-regla-suspension",
      accion: "pagar",
      facturaPagadaId: facturaPagada.id,
      anuladas: r.anuladas,
      realineo: r.realineo.tipo,
      fallos: r.fallos,
    });
    if (r.fallos.length > 0) await avisarFalloDeRegla(deps, "pagar", r.fallos);
  } catch (err) {
    await falloDeReglaInesperado(deps, "pagar", err);
  }
}

async function reglaTrasSubir(deps: DepsPago, stripe: StripePago, subId: string): Promise<void> {
  const real = stripe as unknown as StripeParaSuspension;
  try {
    // El `update` con `billing_cycle_anchor: "now"` ya dejó el ciclo en «hoy»: NO se re-alinea. Solo se anulan las
    // demás facturas abiertas de meses sin servicio (la de la subida es `subscription_update` y no entra en la lista).
    const abiertas = await facturasAbiertasDelPlan(real, subId);
    const { anuladas, fallos } = await anularFacturasDeMesesSuspendidos(real, deps.clinica.id, abiertas);
    await deps.auditar({ event: "pago-pendiente-regla-suspension", accion: "subir", anuladas, fallos });
    if (fallos.length > 0) await avisarFalloDeRegla(deps, "subir", ["No se pudieron anular todas las facturas abiertas de meses sin servicio."]);
  } catch (err) {
    await falloDeReglaInesperado(deps, "subir", err);
  }
}

async function avisarFalloDeRegla(deps: DepsPago, accion: string, fallos: string[]): Promise<void> {
  await deps.avisarAlAdmin(avisoFalloReglaSuspension({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, accion, fallos })).catch(() => {});
}

async function falloDeReglaInesperado(deps: DepsPago, accion: string, err: unknown): Promise<void> {
  const e = err as { message?: string } | null;
  await deps.auditar({ event: "pago-pendiente-regla-suspension-fallo", accion, mensajeStripe: e?.message ?? null }).catch(() => {});
  await avisarFalloDeRegla(deps, accion, [FALLO_LECTURA_REGLA]);
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function consultarPendiente(deps: DepsPago): Promise<RespuestaPago> {
  const ctx = await cargarPendiente(deps, true, true);
  if (!ctx.ok) return "respuesta" in ctx ? ctx.respuesta : respuesta(200, { estado: "sin_pendiente" });
  const deuda = ctx.factura ?? ctx.anulada?.factura;
  if (!deuda) return respuesta(200, { estado: "sin_pendiente" });

  const interval = subscriptionItemInterval(ctx.sub.items.data[0]);
  const exencion = await deps.exencionIva();
  const opciones: OpcionSubir[] = [];
  // Con el cobro en pausa («Subir» respondería 409 PAGADO_POR_ADELANTADO) no se ofrece ningún plan.
  const enPausa = !!ctx.sub.pause_collection;
  for (const id of enPausa ? [] : planesMasGrandes(deps.clinica.plan)) {
    if (await deps.bloqueoDeSedes(id)) continue; // un plan que las sedes no admiten no se ofrece
    opciones.push(opcionDeSubida({ plan: await deps.plan(id), interval, exencion }));
  }
  return respuesta(200, {
    estado: "pendiente",
    planActual: deps.clinica.plan,
    montoPendiente: deuda.amount_due / 100,
    moneda: MONEDA_PAGO,
    opcionesSubir: opciones,
    ...(enPausa ? { subirNoDisponible: MENSAJES.pagadoPorAdelantado } : {}),
    // Solo cuando un cambio de plan quedó a medias: no hay factura que «pagar», solo terminar la subida
    // (POST subir). Con esto presente, «Pagar mi plan» no aplica.
    ...(ctx.anulada ? { cambioEnCurso: { plan: ctx.anulada.planMarcado } } : {}),
  });
}

// ── POST { accion: "pagar" } ────────────────────────────────────────────────

export async function pagarPendiente(deps: DepsPago): Promise<RespuestaPago> {
  // ANTES de tocar nada: ¿estaba SUSPENDIDA (sin acceso)? Después de pagar ya no hay forma de saberlo. Dentro de las
  // 24 h de gracia no lo está y el ciclo no cambia.
  const estabaSuspendida = clinicaEstabaSuspendida(deps.clinica);
  const ctx = await cargarPendiente(deps, false);
  if (!ctx.ok) return "respuesta" in ctx ? ctx.respuesta : respuesta(409, { code: "SIN_PENDIENTE", error: MENSAJES.sinPendiente });
  const { stripe, factura } = ctx;
  if (!factura) return respuesta(409, { code: "SIN_PENDIENTE", error: MENSAJES.sinPendiente });
  const clinicId = deps.clinica.id;

  let pagada: FacturaPago | null = null;
  let rechazo: unknown = null;
  try {
    // Con el método guardado, sin pasar otro: es la factura del plan actual, tal cual está.
    pagada = await stripe.invoices.pay(factura.id, {}, { idempotencyKey: claves.pagar(clinicId, factura.id, factura.attempt_count) });
  } catch (err) {
    if (!isStripeChargeFailure(err)) return falloDeStripe(deps, "pagar", err);
    rechazo = err;
  }

  const final: FacturaPago = pagada ?? factura;
  // Cobrada una clínica que estaba suspendida: los meses sin servicio se anulan y el ciclo pasa a «hoy + 30 días».
  if (final.status === "paid" && estabaSuspendida) await reglaTrasPagar(deps, stripe, final);
  await deps.auditar({
    event: "pago-pendiente-pagar",
    estabaSuspendida,
    facturaId: factura.id,
    montoMxn: factura.amount_due / 100,
    pagado: final.status === "paid",
    // Informativo: la factura puede venir del primer cobro con la promo; aquí no se cambia su monto.
    facturaConPromo: facturaTienePromo(factura),
    ...(rechazo ? { code: codigoDe(rechazo) ?? null, error: chargeFailureMessage(rechazo) } : {}),
  });
  return resultadoDeFactura(final);
}

// ── POST { accion: "subir", plan } ──────────────────────────────────────────

export async function subirYPagar(deps: DepsPago, destino: PlanId): Promise<RespuestaPago> {
  // Lo barato primero (sin candado): permiso y tier. Después, UN solo «subir» a la vez por clínica: la segunda
  // pestaña recibe «ya hay un cambio en curso» ANTES de que se quite o se anule nada. El candado caduca solo.
  if (!isClinicBillingAdmin(deps.role)) {
    return respuesta(403, { code: "FORBIDDEN_NOT_CLINIC_ADMIN", error: MENSAJES.sinPermiso });
  }
  if (!esPlanMasGrande(deps.clinica.plan, destino)) {
    return respuesta(400, { code: "PLAN_NO_MAS_GRANDE", error: MENSAJES.planNoMasGrande });
  }
  const clave = claves.candadoSubir(deps.clinica.id);
  const dueno = randomUUID();
  if (!(await deps.candado.tomar(clave, TTL_CANDADO_SUBIR_SEG, dueno))) {
    return respuesta(409, { code: "CAMBIO_EN_CURSO", error: MENSAJES.cambioEnCurso });
  }
  try {
    return await subirYPagarConCandado(deps, destino);
  } finally {
    await deps.candado.soltar(clave, dueno).catch(() => {}); // si no se puede soltar, caduca solo
  }
}

/** Cuánto vive el candado de «subir» si el proceso muere con él tomado: más que lo que tarda la operación entera. */
const TTL_CANDADO_SUBIR_SEG = 90;

async function subirYPagarConCandado(deps: DepsPago, destino: PlanId): Promise<RespuestaPago> {
  // ANTES de tocar nada: ¿estaba suspendida? (ver `reglaTrasSubir`).
  const estabaSuspendida = clinicaEstabaSuspendida(deps.clinica);
  // Lo barato primero, y TODO antes de anular nada: la factura vieja solo se anula cuando el resto ya
  // se sabe que va a poder hacerse.
  if (!isClinicBillingAdmin(deps.role)) {
    return respuesta(403, { code: "FORBIDDEN_NOT_CLINIC_ADMIN", error: MENSAJES.sinPermiso });
  }
  if (!esPlanMasGrande(deps.clinica.plan, destino)) {
    return respuesta(400, { code: "PLAN_NO_MAS_GRANDE", error: MENSAJES.planNoMasGrande });
  }
  const sedesBloquean = await deps.bloqueoDeSedes(destino);
  if (sedesBloquean) return respuesta(409, { code: "SEDES_ACTIVAS", error: sedesBloquean });

  const ctx = await cargarPendiente(deps, false, true);
  if (!ctx.ok) return "respuesta" in ctx ? ctx.respuesta : respuesta(409, { code: "SIN_PENDIENTE", error: MENSAJES.sinPendiente });
  const { stripe, sub, anulada } = ctx;
  // La factura que ancla las claves de idempotencia: la abierta o, en un reintento, la ya anulada.
  const factura = ctx.factura ?? anulada?.factura;
  if (!factura) return respuesta(409, { code: "SIN_PENDIENTE", error: MENSAJES.sinPendiente });
  const clinicId = deps.clinica.id;

  // La suscripción YA está en el plan destino (el update llegó a Stripe y solo faltó reflejarlo aquí): no se
  // anula ni se cambia nada, para no cobrar dos veces. Se refleja el plan y se devuelve el estado de la factura.
  if (ctx.factura && sub.metadata?.plan === destino) {
    await deps.aplicarPlanLocal(destino);
    await quitarDescuentoDelCliente(deps, stripe, sub, destino); // el cambio ya está hecho: no hay nada que reponer
    return resultadoDeFactura(ctx.factura);
  }

  // V2(a): con el cobro de la suscripción EN PAUSA (meses pagados por adelantado, o ciclo re-alineado tras una
  // suspensión) Stripe anula todas las facturas que nacen durante la pausa: el cambio de plan saldría GRATIS y
  // además se anularía la factura vieja. No se sube de plan en autoservicio; se manda a soporte, sin tocar nada.
  if (sub.pause_collection) {
    await deps.auditar({ event: "pago-pendiente-subir-bloqueado-por-pausa", planDestino: destino, reanudaEn: sub.pause_collection.resumes_at ?? null });
    return respuesta(409, { code: "PAGADO_POR_ADELANTADO", error: MENSAJES.pagadoPorAdelantado });
  }

  const item = sub.items.data[0];
  if (!item) return respuesta(502, { code: "SUSCRIPCION_SIN_ITEMS", error: MENSAJES.sinPlanAsociado });

  // IVA del cambio de plan (Ajuste 1c). Sin IVA configurado NO se cobra sin IVA en silencio.
  const exencion = await deps.exencionIva();
  const iva = ivaParaPagoDeClinica(deps.env, { metodo: "card", plan: destino, exencion });
  if (iva.ok === false) return respuesta(503, { code: iva.codigo, error: iva.error });

  // Precio de LISTA del plan nuevo, en el intervalo de la suscripción (anual sigue anual). Nada de promo.
  const plan = await deps.plan(destino);
  const interval = subscriptionItemInterval(item);
  const cents = planAmountCents(plan, interval);

  let precioId: string;
  try {
    precioId = (
      await stripe.prices.create(buildTargetPriceParams(plan, interval), { idempotencyKey: claves.precio(clinicId, destino, interval, cents) })
    ).id;
  } catch (err) {
    return falloDeStripe(deps, "precio", err);
  }

  // 0) Un cupón puesto en el CLIENTE de Stripe (no en la suscripción) también se quita al subir (decisión de
  // Rafael, Q7/S1): se quita ANTES del cambio, porque Stripe cobra la factura nueva en el mismo instante del
  // `subscriptions.update` y así sale a precio de lista = lo mostrado. Como quitarlo es irreversible, se guarda
  // cuál era y, si algo falla y el cambio NO quedó hecho (se comprueba), se VUELVE A PONER (`fallar`, abajo).
  // Antes de nada se comprueba que el cliente de la suscripción sea el de esta clínica.
  const clienteStripe = clienteDe(sub);
  if (clienteStripe?.discount && clienteStripe.id !== deps.clinica.stripeCustomerId) {
    await deps.auditar({ event: "pago-pendiente-descuento-cliente-ajeno", clienteSuscripcion: clienteStripe.id });
    return respuesta(502, { code: "STRIPE_ERROR", error: MENSAJES.stripeNoContesto });
  }
  const quitado = await quitarDescuentoDelCliente(deps, stripe, sub, destino);
  if (quitado.estado === "fallo") return falloDeStripe(deps, "quitar-descuento-cliente", quitado.err); // aún no se tocó nada más
  /**
   * Algo falló (o la respuesta no llegó): devuelve el error y, SOLO si se comprueba que el cambio de plan no quedó
   * hecho ni lo está haciendo otra petición, repone el cupón. Quien llama no sabe si el cambio llegó a Stripe;
   * esto lo averigua.
   */
  const fallar = async (r: RespuestaPago, motivo: string, err?: unknown): Promise<RespuestaPago> => {
    if (quitado.estado !== "quitado") return r;
    // Antes de reponer hay que saber si el cambio NO quedó hecho. Se repone si falló de verdad; NO se repone si
    //  (a) Stripe rechazó por una clave en curso (otra pestaña lo está haciendo), o
    //  (b) la suscripción ya está en el plan destino (el cambio llegó a Stripe aunque la respuesta se perdiera).
    // Si no se puede comprobar (Stripe no contesta), se repone: es lo reversible y nunca deja a la clínica sin
    // cupón y sin plan; lo anota la bitácora.
    if (esErrorDeIdempotencia(err)) {
      await noReponerPorOtroCambio(deps, quitado, destino, "idempotencia", motivo);
      return r;
    }
    let verificado = true;
    try {
      const viva = await stripe.subscriptions.retrieve(sub.id);
      if (viva.metadata?.plan === destino) {
        await noReponerPorOtroCambio(deps, quitado, destino, "plan-ya-en-destino", motivo);
        return r;
      }
    } catch {
      verificado = false;
    }
    if (!verificado) {
      // No se pudo comprobar si el cambio llegó a Stripe: pudo quedar hecho con el cupón repuesto encima. Además
      // de la bitácora se avisa al admin para que revise el plan y el cupón de esta clínica.
      await deps.auditar({ event: "pago-pendiente-descuento-cliente-reposicion-sin-verificar", motivo, planDestino: destino }).catch(() => {});
      await deps
        .avisarAlAdmin(
          avisoReposicionSinVerificar({
            clinicaId: deps.clinica.id,
            clinicaNombre: deps.clinica.nombre,
            clienteStripe: quitado.clienteId,
            cupon: quitado.descuento.coupon?.id ?? null,
            codigoPromocional: idDeCodigoPromocional(quitado.descuento),
            planDestino: destino,
          }),
        )
        .catch(() => {});
    }
    await reponerDescuentoDelCliente(deps, stripe, quitado, destino, motivo);
    return r;
  };

  // 1) Se ANULA la factura abierta del plan viejo (nunca se borra), DESPUÉS de marcarla: si el cambio de
  // abajo falla de red, el reintento encuentra la marca y lo termina en vez de responder «sin pendiente».
  // Si otro POST ya la anuló, se sigue. En un reintento (`anulada`) ya está marcada y anulada: se salta.
  if (!anulada) {
    const ahora = new Date();
    try {
      await stripe.invoices.update(
        factura.id,
        { metadata: armarMarca({ destino, desde: deps.clinica.plan, clave: claves.subir(clinicId, factura.id, destino), ahora }) },
        // La hora es un parámetro: va en la clave. Un reintento con otra hora usa otra clave en vez de
        // chocar con la anterior (Stripe rechaza una misma clave con otros parámetros durante 24 h).
        { idempotencyKey: claves.marcar(clinicId, factura.id, destino, segundosDe(ahora)) },
      );
    } catch (err) {
      // Aun así, si Stripe dice idempotency_error se relee la factura: si ya quedó marcada para este plan
      // (la llamada anterior sí se aplicó) se sigue; si no, nada cambió y la factura sigue abierta.
      let marcada = false;
      if (codigoDe(err) === "idempotency_error" || (err as { type?: string } | null)?.type === "StripeIdempotencyError") {
        try {
          marcada = (await stripe.invoices.retrieve(factura.id)).metadata?.[MARCA.plan] === destino;
        } catch {
          marcada = false;
        }
      }
      if (!marcada) return fallar(await falloDeStripe(deps, "marcar", err), "marcar-factura", err);
    }
    try {
      await stripe.invoices.voidInvoice(factura.id, {}, { idempotencyKey: claves.anular(clinicId, factura.id) });
    } catch (err) {
      let yaAnulada = false;
      try {
        yaAnulada = (await stripe.invoices.retrieve(factura.id)).status === "void";
      } catch {
        yaAnulada = false;
      }
      if (!yaAnulada) return fallar(await falloDeStripe(deps, "anular", err), "anular-factura", err);
    }
  }

  // 2) La MISMA suscripción pasa al plan nuevo y se cobra completo ahora.
  let nueva: SuscripcionPago & { latest_invoice?: string | FacturaPago | null };
  try {
    nueva = await stripe.subscriptions.update(
      sub.id,
      armarUpdateSubir({ sub, itemId: item.id, priceId: precioId, plan: destino, clinicId, iva }) as unknown as Record<string, unknown>,
      { idempotencyKey: claves.subir(clinicId, factura.id, destino) },
    );
  } catch (err) {
    // Si la tarjeta falló en este paso la factura nueva puede haber quedado abierta: se da su enlace.
    let abierta: FacturaPago | null = null;
    try {
      abierta = facturaAbiertaMasReciente((await stripe.invoices.list({ subscription: sub.id, status: "open", limit: 10 })).data, deps.clinica.stripeCustomerId);
    } catch {
      abierta = null;
    }
    await deps.auditar({
      event: "pago-pendiente-subir-fallo",
      reintento: !!anulada,
      facturaAnuladaId: factura.id,
      planDestino: destino,
      code: codigoDe(err) ?? null,
    });
    // El cambio SÍ quedó hecho (la tarjeta falló en la factura nueva, a precio de lista): el cupón no se repone.
    if (abierta?.hosted_invoice_url && isStripeChargeFailure(err)) return resultadoDeFactura(abierta);
    return fallar(await falloDeStripe(deps, "cambiar-plan", err), "cambiar-plan", err);
  }

  let nuevaFactura: FacturaPago | null = null;
  const li = nueva.latest_invoice;
  if (li && typeof li === "object") nuevaFactura = li;
  else if (typeof li === "string") {
    try {
      nuevaFactura = await stripe.invoices.retrieve(li);
    } catch {
      nuevaFactura = null;
    }
  }

  // V2 (red de seguridad): si la factura del cambio NACIÓ ANULADA (cobro en pausa que no se vio antes), la subida
  // saldría gratis. No se da por cobrada ni se refleja el plan como pagado: queda en la bitácora, se avisa al admin
  // y la clínica recibe un mensaje claro sin nombrar al proveedor.
  if (nuevaFactura?.status === "void") {
    await deps.auditar({ event: "pago-pendiente-subir-sin-cobro", facturaNuevaId: nuevaFactura.id, planDestino: destino }).catch(() => {});
    await deps
      .avisarAlAdmin(avisoSubidaSinCobro({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, facturaId: nuevaFactura.id, planDestino: destino }))
      .catch(() => {});
    return respuesta(502, { code: "SUBIDA_SIN_COBRO", error: MENSAJES.subidaSinCobro });
  }

  // La suscripción ya está en el plan nuevo: lo mismo que reflejará el webhook con su metadata.plan.
  await deps.aplicarPlanLocal(destino);

  // Regla de la suspensión: los demás meses abiertos de la clínica suspendida no se deben (se anulan, nada se borra).
  if (estabaSuspendida) await reglaTrasSubir(deps, stripe, sub.id);

  await deps.auditar({
    event: "pago-pendiente-subir",
    estabaSuspendida,
    planAntes: deps.clinica.plan,
    planDestino: destino,
    reintento: !!anulada,
    facturaAnuladaId: factura.id,
    facturaNuevaId: nuevaFactura?.id ?? null,
    subtotalMxn: cents / 100,
    // Decisión de Rafael (#10): al subir se quitan TODOS los descuentos de la suscripción.
    descuentosQuitados: idsDeDescuentos(sub),
    promoQuitada: idsDePromo(sub),
    // El cupón puesto en el CLIENTE se quitó ANTES del cambio (la factura nueva sale a precio de lista).
    ...(quitado.estado === "quitado" ? { descuentoDelClienteQuitado: quitado.descuento.id } : {}),
    montoEsperadoMxn: opcionDeSubida({ plan, interval, exencion }).monto,
    ivaModo: iva.modo,
    montoCobradoMxn: nuevaFactura ? nuevaFactura.amount_due / 100 : null,
    pagado: nuevaFactura?.status === "paid",
    intervalo: interval,
  });

  // Red de seguridad (c): si lo cobrado quedó por debajo de lo mostrado (un descuento que no se quitó: dos
  // pestañas, un cupón nuevo…), queda en la bitácora y se avisa al admin para que lo revise.
  const esperado = opcionDeSubida({ plan, interval, exencion }).monto;
  const cobrado = nuevaFactura ? (nuevaFactura.total ?? nuevaFactura.amount_due) / 100 : null;
  if (nuevaFactura && cobrado !== null && cobrado < esperado - 0.005) {
    await deps.auditar({ event: "pago-pendiente-subir-cobro-menor", facturaNuevaId: nuevaFactura.id, cobradoMxn: cobrado, esperadoMxn: esperado, planDestino: destino }).catch(() => {});
    await deps
      .avisarAlAdmin(avisoCobroMenorQueLoMostrado({ clinicaId: deps.clinica.id, clinicaNombre: deps.clinica.nombre, facturaId: nuevaFactura.id, cobradoMxn: cobrado, esperadoMxn: esperado, planDestino: destino }))
      .catch(() => {});
  }
  return resultadoDeFactura(nuevaFactura);
}
