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

import { isClinicBillingAdmin } from "./authz";
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
  };
}

export interface ClinicaPago {
  id: string;
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

/**
 * Quita el cupón puesto en el CLIENTE de Stripe (`customers.deleteDiscount`) y devuelve su id (o null).
 * Se llama SOLO cuando el cambio de plan ya respondió bien. Nunca lanza ni bloquea: el plan ya cambió y la
 * factura nueva ya se cobró, así que un fallo aquí se registra en la bitácora (el cupón sigue puesto, no se
 * pierde) y no deshace nada. Solo toca el cliente de Stripe de ESTA clínica. DELETE es idempotente por
 * definición (Stripe ignora la clave en DELETE): si otro POST ya lo quitó, Stripe responde «no tiene
 * descuento» (resource_missing) y se sigue.
 */
async function quitarDescuentoDelCliente(deps: DepsPago, stripe: StripePago, sub: SuscripcionPago, destino: PlanId): Promise<string | null> {
  const cliente = clienteDe(sub);
  const descuento = cliente?.discount;
  if (!cliente || !descuento) return null;
  if (!deps.clinica.stripeCustomerId || cliente.id !== deps.clinica.stripeCustomerId) {
    await deps.auditar({ event: "pago-pendiente-descuento-cliente-ajeno", clienteSuscripcion: cliente.id });
    return null;
  }
  try {
    await stripe.customers.deleteDiscount(cliente.id, {}, { idempotencyKey: claves.quitarDescuentoCliente(deps.clinica.id, descuento.id) });
  } catch (err) {
    if (codigoDe(err) !== "resource_missing") {
      const e = err as { message?: string; type?: string } | null;
      await deps
        .auditar({
          event: "pago-pendiente-descuento-cliente-no-quitado",
          descuentoId: descuento.id,
          cupon: descuento.coupon?.id ?? null,
          planDestino: destino,
          code: codigoDe(err) ?? null,
          tipo: e?.type ?? null,
          mensajeStripe: e?.message ?? null,
        })
        .catch(() => {});
      return null;
    }
  }
  await deps.auditar({ event: "pago-pendiente-descuento-cliente-quitado", descuentoId: descuento.id, cupon: descuento.coupon?.id ?? null, planDestino: destino });
  return descuento.id;
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

// ── GET ─────────────────────────────────────────────────────────────────────

export async function consultarPendiente(deps: DepsPago): Promise<RespuestaPago> {
  const ctx = await cargarPendiente(deps, true, true);
  if (!ctx.ok) return "respuesta" in ctx ? ctx.respuesta : respuesta(200, { estado: "sin_pendiente" });
  const deuda = ctx.factura ?? ctx.anulada?.factura;
  if (!deuda) return respuesta(200, { estado: "sin_pendiente" });

  const interval = subscriptionItemInterval(ctx.sub.items.data[0]);
  const exencion = await deps.exencionIva();
  const opciones: OpcionSubir[] = [];
  for (const id of planesMasGrandes(deps.clinica.plan)) {
    if (await deps.bloqueoDeSedes(id)) continue; // un plan que las sedes no admiten no se ofrece
    opciones.push(opcionDeSubida({ plan: await deps.plan(id), interval, exencion }));
  }
  return respuesta(200, {
    estado: "pendiente",
    planActual: deps.clinica.plan,
    montoPendiente: deuda.amount_due / 100,
    moneda: MONEDA_PAGO,
    opcionesSubir: opciones,
    // Solo cuando un cambio de plan quedó a medias: no hay factura que «pagar», solo terminar la subida
    // (POST subir). Con esto presente, «Pagar mi plan» no aplica.
    ...(ctx.anulada ? { cambioEnCurso: { plan: ctx.anulada.planMarcado } } : {}),
  });
}

// ── POST { accion: "pagar" } ────────────────────────────────────────────────

export async function pagarPendiente(deps: DepsPago): Promise<RespuestaPago> {
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
  await deps.auditar({
    event: "pago-pendiente-pagar",
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
    await quitarDescuentoDelCliente(deps, stripe, sub, destino); // el cambio ya está hecho: ahora sí
    return resultadoDeFactura(ctx.factura);
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
  // Rafael, Q7), pero NO aquí: se quita DESPUÉS de que el cambio de plan respondió bien (paso 3). Quitarlo antes
  // dejaba, si el cambio fallaba de red, a la clínica sin cupón y sin plan nuevo. Aquí solo se comprueba que el
  // cliente de la suscripción sea el de esta clínica, para no empezar nada con un cliente ajeno.
  const clienteStripe = clienteDe(sub);
  if (clienteStripe?.discount && clienteStripe.id !== deps.clinica.stripeCustomerId) {
    await deps.auditar({ event: "pago-pendiente-descuento-cliente-ajeno", clienteSuscripcion: clienteStripe.id });
    return respuesta(502, { code: "STRIPE_ERROR", error: MENSAJES.stripeNoContesto });
  }

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
      if (!marcada) return falloDeStripe(deps, "marcar", err);
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
      if (!yaAnulada) return falloDeStripe(deps, "anular", err);
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
    if (abierta?.hosted_invoice_url && isStripeChargeFailure(err)) return resultadoDeFactura(abierta);
    return falloDeStripe(deps, "cambiar-plan", err);
  }

  // La suscripción ya está en el plan nuevo: lo mismo que reflejará el webhook con su metadata.plan.
  await deps.aplicarPlanLocal(destino);

  // 3) Ahora que el cambio respondió bien, se quita el cupón del CLIENTE (nunca antes: ver el paso 0).
  const descuentoDelClienteQuitado = await quitarDescuentoDelCliente(deps, stripe, sub, destino);

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

  await deps.auditar({
    event: "pago-pendiente-subir",
    planAntes: deps.clinica.plan,
    planDestino: destino,
    reintento: !!anulada,
    facturaAnuladaId: factura.id,
    facturaNuevaId: nuevaFactura?.id ?? null,
    subtotalMxn: cents / 100,
    // Decisión de Rafael (#10): al subir se quitan TODOS los descuentos de la suscripción.
    descuentosQuitados: idsDeDescuentos(sub),
    promoQuitada: idsDePromo(sub),
    // El cupón puesto en el CLIENTE se quita DESPUÉS del cambio. Stripe cobra la factura nueva en el mismo
    // instante del cambio, así que si el cliente traía cupón esa primera factura pudo salir con él.
    ...(descuentoDelClienteQuitado ? { descuentoDelClienteQuitado } : {}),
    ...(descuentoDelClienteQuitado && nuevaFactura && nuevaFactura.amount_due / 100 < opcionDeSubida({ plan, interval, exencion }).monto
      ? { cobroConDescuentoDelCliente: true }
      : {}),
    montoEsperadoMxn: opcionDeSubida({ plan, interval, exencion }).monto,
    ivaModo: iva.modo,
    montoCobradoMxn: nuevaFactura ? nuevaFactura.amount_due / 100 : null,
    pagado: nuevaFactura?.status === "paid",
    intervalo: interval,
  });
  return resultadoDeFactura(nuevaFactura);
}
