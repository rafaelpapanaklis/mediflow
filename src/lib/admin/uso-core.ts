/**
 * CUPOS y CONSUMO de una clínica para /admin — módulo PURO (sin Prisma, sin
 * React, sin `server-only`). Lo consumen el Dashboard, la lista de Clínicas,
 * la ficha de clínica y Clientes; la lectura de la base vive en
 * `./uso-clinica` (server). Se prueba con `npm run test:admin-uso`.
 *
 * ── De dónde sale cada dato (y qué NO se inventa) ───────────────────────────
 *  · Almacenamiento usado = patient_files.size + clinical_photos.sizeBytes
 *    (vivas) + patient_uploads.sizeBytes. Es EXACTAMENTE la suma con la que
 *    `storageQuotaError` (@/lib/storage-quota) decide si una subida cabe en el
 *    plan; el tope es `plan_configs.storageBytes`. Subestima el uso real:
 *    varias rutas suben a Storage sin registrar tamaño (ver ese archivo).
 *  · Tokens IA = Clinic.aiTokensUsed / aiTokensLimit, con el contador puesto a
 *    0 si `aiLastResetAt` es de un mes anterior (`tokensVigentes`), igual que
 *    /api/ai/usage: el reseteo real sólo ocurre en la primera llamada del mes.
 *  · CFDI del mes = cfdi_usage.stamped del periodo «YYYY-MM» de la clínica;
 *    incluidos = plan_configs.cfdiMonthly. Misma lectura que /api/cfdi/usage.
 *  · Usuarios = filas User activas de la clínica; tope = plan_configs.maxUsers.
 *  · Sedes = clínicas de las que el dueño es SUPER_ADMIN activo (el mismo
 *    conteo que `countOwnedClinics`); tope = plan_configs.maxClinics.
 *  · Saldo IA = ai_wallets.balanceCents; «bajo» por la regla de
 *    @/lib/ai-billing/saldo-estado.
 */
import { LOW_BALANCE_CENTS } from "@/lib/ai-billing/saldo-estado";

/**
 * Tokens IA consumidos ESTE mes. `aiTokensUsed` sólo se pone a cero en la
 * primera llamada de IA del mes (@/lib/ai-tokens), así que un contador de
 * agosto que nadie ha tocado en septiembre sigue diciendo «200k». Misma
 * aritmética que /api/ai/usage (mes de calendario con getters locales): si el
 * último reseteo es de un mes anterior, este mes lleva 0.
 */
export function tokensVigentes(usados: number, ultimoReseteo: Date | string | null | undefined, ahora: Date): number {
  if (!ultimoReseteo) return usados;
  const r = ultimoReseteo instanceof Date ? ultimoReseteo : new Date(ultimoReseteo);
  if (Number.isNaN(r.getTime())) return usados;
  const meses = (ahora.getFullYear() - r.getFullYear()) * 12 + (ahora.getMonth() - r.getMonth());
  return meses >= 1 ? 0 : usados;
}

export type NivelCupo = "ok" | "aviso" | "lleno";

/** Desde qué proporción un cupo pasa a aviso (mismo umbral que el de pacientes). */
export const CUPO_AVISO_RATIO = 0.8;

/** Con menos días que esto por delante, una renovación es «de esta semana». */
export const DIAS_RENOVACION_PROXIMA = 7;

/** Porcentaje entero 0–100 (saturado) o null si no hay tope. */
export function pctCupo(usado: number, tope: number | null | undefined): number | null {
  if (tope === null || tope === undefined || tope <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((usado / tope) * 100)));
}

/** Sin tope = siempre ok. ≥100 % lleno, ≥80 % aviso. */
export function nivelCupo(usado: number, tope: number | null | undefined): NivelCupo {
  if (tope === null || tope === undefined || tope <= 0) return "ok";
  if (usado >= tope) return "lleno";
  return usado / tope >= CUPO_AVISO_RATIO ? "aviso" : "ok";
}

/** Lo medido de una clínica. `null` en un tope = ilimitado; en un usado = no se pudo medir. */
export interface UsoClinica {
  storageUsado: number | null;
  storageTope: number | null;
  tokensUsados: number;
  tokensTope: number;
  cfdiUsados: number | null;
  cfdiIncluidos: number;
  usuarios: number | null;
  usuariosTope: number | null;
  sedes: number | null;
  sedesTope: number | null;
  /** null = sin monedero (no es saldo 0). */
  saldoIaCents: number | null;
  /** ACTIVE | PAUSED; `SIN_DATO` si la consulta de monederos falló. */
  saldoIaStatus: string | null;
}

export const USO_VACIO: UsoClinica = {
  storageUsado: null, storageTope: null, tokensUsados: 0, tokensTope: 0,
  cfdiUsados: null, cfdiIncluidos: 0, usuarios: null, usuariosTope: null,
  sedes: null, sedesTope: null, saldoIaCents: null, saldoIaStatus: null,
};

/** "3.2 GB", "412 MB". Mismo criterio que formatBytes de plan-shared, sin importarlo (client-safe igual). */
export function bytesCortos(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < unidades.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${unidades[i]}`;
}

/** "612k", "1.2M": tokens en corto para tablas. */
export function tokensCortos(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ── Método de pago ─────────────────────────────────────────────────────────

export interface DatosMetodoPago {
  /** Suscripción viva en Stripe: cobra sola, mande lo que mande el alta. */
  stripeSubscriptionId?: string | null;
  paymentMethodType?: string | null;
  paymentMethodLast4?: string | null;
  preferredPaymentMethod?: string | null;
  stripeCustomerId?: string | null;
  paypalSubscriptionId?: string | null;
}

const METODO: Record<string, string> = {
  stripe: "Stripe", transfer: "Transferencia", spei: "SPEI", deposit: "Depósito",
  oxxo: "OXXO", paypal: "PayPal", cash: "Efectivo", mercadopago: "Mercado Pago",
};

/**
 * Cómo paga la clínica, en dos palabras, y si el cobro es MANUAL (alguien
 * tiene que transferir y Rafael verificar) o automático.
 *
 * Manda lo que cobra HOY: una suscripción viva en Stripe o PayPal cobra sola
 * aunque en el alta se eligiera «transferencia» (los campos paymentMethod* los
 * escribe el registro y nadie los actualiza: el alta arranca en «transfer» por
 * defecto). Sólo sin suscripción se mira lo del alta. «No registrado» no es
 * «no paga».
 */
export function metodoDePago(c: DatosMetodoPago): { etiqueta: string; manual: boolean } {
  if (c.stripeSubscriptionId) {
    return {
      etiqueta: c.paymentMethodType === "card" && c.paymentMethodLast4 ? `Tarjeta ••${c.paymentMethodLast4}` : "Stripe",
      manual: false,
    };
  }
  if (c.paypalSubscriptionId || c.paymentMethodType === "paypal") return { etiqueta: "PayPal", manual: false };
  if (c.paymentMethodType === "card") {
    return { etiqueta: `Tarjeta ••${c.paymentMethodLast4 ?? "••••"}`, manual: false };
  }
  if (c.paymentMethodType === "transfer") return { etiqueta: "Transferencia", manual: true };
  if (c.preferredPaymentMethod && c.preferredPaymentMethod !== "none") {
    const m = c.preferredPaymentMethod;
    return { etiqueta: METODO[m] ?? m, manual: m !== "stripe" && m !== "paypal" && m !== "mercadopago" };
  }
  if (c.stripeCustomerId) return { etiqueta: "Stripe", manual: false };
  return { etiqueta: "No registrado", manual: true };
}

// ── Última compra ──────────────────────────────────────────────────────────

export interface FilaConCompra {
  /** Último pago de suscripción `paid` (subscription_invoices.paidAt). */
  ultimoPagoAt: Date | string | null | undefined;
  createdAt: Date | string;
}

function aFecha(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * «Última compra» = fecha del último pago de suscripción cobrado. Si la
 * clínica nunca pagó, se usa su alta y se marca `esAlta` para que la pantalla
 * lo diga («alta», no «compra»).
 */
export function ultimaCompra(f: FilaConCompra): { fecha: Date | null; esAlta: boolean } {
  const pago = aFecha(f.ultimoPagoAt);
  if (pago) return { fecha: pago, esAlta: false };
  return { fecha: aFecha(f.createdAt), esAlta: true };
}

/**
 * Orden por defecto de Clínicas y Clientes: la compra MÁS NUEVA arriba. Las
 * que compraron van antes que las que sólo se dieron de alta; dentro de cada
 * grupo, la fecha más reciente primero.
 */
export function compararUltimaCompraDesc(a: FilaConCompra, b: FilaConCompra): number {
  const ca = ultimaCompra(a), cb = ultimaCompra(b);
  if (ca.esAlta !== cb.esAlta) return ca.esAlta ? 1 : -1;
  return (cb.fecha?.getTime() ?? 0) - (ca.fecha?.getTime() ?? 0);
}

// ── Señales de cupo y cobro para el Dashboard ──────────────────────────────

export type SeveridadCupo = "alto" | "medio";

export type MotivoCupo =
  | "almacenamiento"
  | "tokens"
  | "cfdi"
  | "usuarios"
  | "saldo-ia"
  | "renovacion-manual"
  | "pago-por-verificar";

export interface SenalCupo {
  clave: string;
  motivo: MotivoCupo;
  severidad: SeveridadCupo;
  clinicaId: string;
  clinicaNombre: string;
  /** Rótulo corto de la señal. */
  titulo: string;
  /** La cifra que la sostiene, ya formateada. */
  dato: string;
  /** Dinero en juego (0 si no es de dinero). */
  monto: number;
  /** Cuántas cosas son (pagos por verificar); 1 si no aplica. */
  cantidad: number;
}

/**
 * ¿Algún cupo al 80 % o más, CFDI por encima de lo incluido, usuarios al tope
 * o saldo IA en problemas? La MISMA regla que `senalesDeCupo`, para que el
 * filtro «Cerca del tope» de Clínicas y la tarjeta del Dashboard cuenten a
 * las mismas clínicas.
 */
export function cercaDelTope(u: UsoClinica | null | undefined): boolean {
  if (!u) return false;
  return senalesDeCupo({
    id: "", nombre: "", uso: u, diasHastaRenovacion: null, suscripcionActiva: false, metodoManual: false,
    pagosPorVerificar: { cuantos: 0, monto: 0 },
  }).length > 0;
}

export interface EntradaSenalCupo {
  id: string;
  nombre: string;
  uso: UsoClinica;
  /** Días hasta el próximo cobro (nextBillingDate); null sin fecha. */
  diasHastaRenovacion: number | null;
  /** Suscripción viva (active): sólo entonces una renovación es cobrable. */
  suscripcionActiva: boolean;
  metodoManual: boolean;
  /** Facturas de suscripción `pending` con método manual: pagos que alguien registró y nadie verificó. */
  pagosPorVerificar: { cuantos: number; monto: number };
}

export const TITULO_MOTIVO_CUPO: Record<MotivoCupo, string> = {
  "almacenamiento": "Almacenamiento",
  "tokens": "Tokens IA",
  "cfdi": "CFDI sobre el cupo",
  "usuarios": "Usuarios al tope",
  "saldo-ia": "Saldo IA",
  "renovacion-manual": "Renovación manual",
  "pago-por-verificar": "Pago por verificar",
};

function pctTexto(usado: number, tope: number): string {
  return `${pctCupo(usado, tope) ?? 0}%`;
}

/** Las señales de cupo/cobro de UNA clínica. Sin dato no hay señal: nunca se supone. */
export function senalesDeCupo(e: EntradaSenalCupo): SenalCupo[] {
  const out: SenalCupo[] = [];
  const u = e.uso;
  const base = { clinicaId: e.id, clinicaNombre: e.nombre, monto: 0, cantidad: 1 };

  if (e.pagosPorVerificar.cuantos > 0) {
    out.push({
      ...base, clave: `${e.id}:pago-por-verificar`, motivo: "pago-por-verificar", severidad: "alto",
      titulo: TITULO_MOTIVO_CUPO["pago-por-verificar"],
      dato: e.pagosPorVerificar.cuantos === 1 ? "1 pago" : `${e.pagosPorVerificar.cuantos} pagos`,
      monto: e.pagosPorVerificar.monto,
      cantidad: e.pagosPorVerificar.cuantos,
    });
  }

  if (
    e.suscripcionActiva && e.metodoManual &&
    e.diasHastaRenovacion !== null && e.diasHastaRenovacion >= 0 && e.diasHastaRenovacion <= DIAS_RENOVACION_PROXIMA
  ) {
    out.push({
      ...base, clave: `${e.id}:renovacion-manual`, motivo: "renovacion-manual", severidad: "alto",
      titulo: TITULO_MOTIVO_CUPO["renovacion-manual"],
      dato: e.diasHastaRenovacion === 0 ? "vence hoy" : `en ${e.diasHastaRenovacion} d`,
    });
  }

  if (u.storageUsado !== null && u.storageTope !== null) {
    const nivel = nivelCupo(u.storageUsado, u.storageTope);
    if (nivel !== "ok") {
      out.push({
        ...base, clave: `${e.id}:almacenamiento`, motivo: "almacenamiento", severidad: nivel === "lleno" ? "alto" : "medio",
        titulo: TITULO_MOTIVO_CUPO.almacenamiento, dato: `${pctTexto(u.storageUsado, u.storageTope)} de ${bytesCortos(u.storageTope)}`,
      });
    }
  }

  if (u.tokensTope > 0) {
    const nivel = nivelCupo(u.tokensUsados, u.tokensTope);
    if (nivel !== "ok") {
      out.push({
        ...base, clave: `${e.id}:tokens`, motivo: "tokens", severidad: nivel === "lleno" ? "alto" : "medio",
        titulo: TITULO_MOTIVO_CUPO.tokens, dato: `${pctTexto(u.tokensUsados, u.tokensTope)} del mes`,
      });
    }
  }

  if (u.cfdiUsados !== null && u.cfdiIncluidos > 0 && u.cfdiUsados > u.cfdiIncluidos) {
    const exceso = u.cfdiUsados - u.cfdiIncluidos;
    out.push({
      ...base, clave: `${e.id}:cfdi`, motivo: "cfdi", severidad: "medio",
      titulo: TITULO_MOTIVO_CUPO.cfdi, dato: exceso === 1 ? "1 timbre extra" : `${exceso} timbres extra`,
    });
  }

  if (u.usuarios !== null && u.usuariosTope !== null && u.usuariosTope > 0 && u.usuarios >= u.usuariosTope) {
    out.push({
      ...base, clave: `${e.id}:usuarios`, motivo: "usuarios", severidad: "medio",
      titulo: TITULO_MOTIVO_CUPO.usuarios, dato: `${u.usuarios} de ${u.usuariosTope}`,
    });
  }

  // Saldo IA: en negativo es un problema; por debajo del umbral de Tesorería,
  // un aviso. Un monedero en $0 exacto NO avisa: se crea con sólo abrir la
  // pantalla del saldo, sin haber recargado nunca, y no hay nada que agotar.
  if (u.saldoIaCents !== null && u.saldoIaStatus !== "SIN_DATO") {
    if (u.saldoIaCents < 0) {
      out.push({
        ...base, clave: `${e.id}:saldo-ia`, motivo: "saldo-ia", severidad: "alto",
        titulo: "Saldo IA en negativo", dato: `$${(u.saldoIaCents / 100).toFixed(2)}`, monto: 0,
      });
    } else if (u.saldoIaCents > 0 && u.saldoIaCents < LOW_BALANCE_CENTS) {
      out.push({
        ...base, clave: `${e.id}:saldo-ia`, motivo: "saldo-ia", severidad: "medio",
        titulo: "Saldo IA bajo", dato: `$${(u.saldoIaCents / 100).toFixed(2)}`,
      });
    }
  }

  return out;
}
