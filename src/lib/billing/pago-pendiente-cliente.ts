/**
 * Cliente del CONTRATO de pago pendiente (ws1-t1 ← ws1-t2). El cobro lo hace el servidor
 * (`/api/billing/pago-pendiente`, rama feat/cobro-fallido-pago-upgrade); aquí solo se lee lo pendiente y se
 * pide el cobro. Puro (recibe `fetch`) para probarlo con respuestas simuladas, incluido el 404 que sale
 * mientras esa ruta no esté unida a esta rama.
 *
 *   GET  → { estado: "sin_pendiente" } | { estado: "pendiente", planActual, montoPendiente, moneda,
 *            opcionesSubir: [{ plan, nombre, monto, ivaIncluido }] }
 *   POST { accion: "pagar" } | { accion: "subir", plan }
 *        → { ok: true, pagado: true } | { ok: true, pagado: false, url } | { error } (400/403/409/502/503)
 *
 * Los errores del servidor vienen en español y se muestran TAL CUAL.
 */

export const RUTA_PAGO_PENDIENTE = "/api/billing/pago-pendiente";

export interface OpcionSubir {
  plan: string;
  nombre: string;
  monto: number;
  ivaIncluido: boolean;
}

export type PagoPendiente =
  | { estado: "sin_pendiente" }
  | {
      estado: "pendiente";
      planActual: string;
      montoPendiente: number;
      moneda: string;
      opcionesSubir: OpcionSubir[];
      /**
       * Solo cuando un «subir de plan» quedó a medias (la factura vieja ya se anuló): no hay nada que «pagar»,
       * solo terminar el cambio a este plan. Con esto presente «Pagar mi plan» no aplica (el servidor respondería 409).
       */
      cambioEnCurso?: { plan: string };
    };

export type LecturaPago =
  | { tipo: "listo"; datos: PagoPendiente }
  /** 404: la ruta aún no existe en esta rama. */
  | { tipo: "no_disponible" }
  | { tipo: "error"; mensaje: string };

/** «Pagar» lleva el monto (pesos) que la pantalla mostró y la clínica confirmó: el servidor no cobra otro (AA6). */
export type OrdenDeCobro = { accion: "pagar"; monto: number } | { accion: "subir"; plan: string };

export type ResultadoCobro =
  | { tipo: "pagado" }
  /**
   * 409 `PAGO_YA_REGISTRADO` («Tu pago ya se registró.»): otra pestaña (u otro botón) ya dejó pagado lo que se iba a pagar.
   * NO es un error para la clínica: se muestra como éxito y se va al panel, igual que `pagado`.
   */
  | { tipo: "ya_registrado"; mensaje: string }
  | { tipo: "url"; url: string }
  | { tipo: "no_disponible" }
  | { tipo: "error"; mensaje: string; codigo?: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function cuerpo(res: Response): Promise<Record<string, unknown>> {
  try {
    const d = await res.json();
    return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function opciones(v: unknown): OpcionSubir[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((o) => {
    const x = o as Partial<OpcionSubir> | null;
    return x && typeof x.plan === "string" && typeof x.nombre === "string" && esNumero(x.monto)
      ? [{ plan: x.plan, nombre: x.nombre, monto: x.monto, ivaIncluido: x.ivaIncluido === true }]
      : [];
  });
}

function cambioEnCurso(v: unknown): { plan: string } | null {
  const x = v as { plan?: unknown } | null;
  return x && typeof x.plan === "string" && x.plan ? { plan: x.plan } : null;
}

export async function leerPagoPendiente(f: Fetch = fetch): Promise<LecturaPago> {
  let res: Response;
  try {
    res = await f(RUTA_PAGO_PENDIENTE, { method: "GET", headers: { Accept: "application/json" } });
  } catch {
    return { tipo: "no_disponible" };
  }
  if (res.status === 404) return { tipo: "no_disponible" };
  const d = await cuerpo(res);
  if (!res.ok) return { tipo: "error", mensaje: typeof d.error === "string" ? d.error : "" };
  if (d.estado === "sin_pendiente") return { tipo: "listo", datos: { estado: "sin_pendiente" } };
  // Se está terminando de aplicar un cambio de plan: se muestra el texto (y las otras formas de pago) en vez de «no hay pago pendiente».
  if (d.estado === "cambio_en_aplicacion") return { tipo: "error", mensaje: typeof d.mensaje === "string" ? d.mensaje : "" };
  if (d.estado === "pendiente" && esNumero(d.montoPendiente)) {
    return {
      tipo: "listo",
      datos: {
        estado: "pendiente",
        planActual: typeof d.planActual === "string" ? d.planActual : "",
        montoPendiente: d.montoPendiente,
        moneda: typeof d.moneda === "string" && d.moneda ? d.moneda : "MXN",
        opcionesSubir: opciones(d.opcionesSubir),
        ...(cambioEnCurso(d.cambioEnCurso) ? { cambioEnCurso: cambioEnCurso(d.cambioEnCurso)! } : {}),
      },
    };
  }
  return { tipo: "error", mensaje: "" };
}

export async function cobrarPendiente(orden: OrdenDeCobro, f: Fetch = fetch): Promise<ResultadoCobro> {
  let res: Response;
  try {
    res = await f(RUTA_PAGO_PENDIENTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orden),
    });
  } catch {
    return { tipo: "error", mensaje: "" };
  }
  if (res.status === 404) return { tipo: "no_disponible" };
  const d = await cuerpo(res);
  if (res.status === 409 && d.code === "PAGO_YA_REGISTRADO") return { tipo: "ya_registrado", mensaje: typeof d.error === "string" ? d.error : "" };
  if (!res.ok || d.ok === false) {
    return { tipo: "error", mensaje: typeof d.error === "string" ? d.error : "", ...(typeof d.code === "string" ? { codigo: d.code } : {}) };
  }
  if (d.pagado === true) return { tipo: "pagado" };
  if (typeof d.url === "string" && d.url) return { tipo: "url", url: d.url };
  return { tipo: "error", mensaje: "" };
}

/** «$689.00 MXN» en el idioma de la clínica. */
export function formatoMonto(monto: number, moneda: string, idioma: string): string {
  try {
    return `${new Intl.NumberFormat(idioma === "en" ? "en-US" : "es-MX", { style: "currency", currency: moneda, currencyDisplay: "narrowSymbol" }).format(monto)} ${moneda}`;
  } catch {
    return `$${monto.toFixed(2)} ${moneda}`;
  }
}

/** ¿Con tarjeta rechazada y suscripción de Stripe viva? Es cuando aplican los dos botones (y no las tarjetas de plan). */
export function tarjetaRechazadaViva(clinic: { subscriptionStatus?: string | null; stripeSubscriptionId?: string | null }): boolean {
  return (clinic.subscriptionStatus === "past_due" || clinic.subscriptionStatus === "unpaid") && !!clinic.stripeSubscriptionId;
}
