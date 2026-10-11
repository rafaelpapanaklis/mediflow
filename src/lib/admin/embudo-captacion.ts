// Embudo de captación para /admin (ws1-t9): cuántos pasan por cada paso en los
// últimos 30 días, leído de la BASE (no de GA4), con el % contra el paso anterior
// y contra la primera fila.
//
// Dos unidades, a propósito, y la tarjeta lo dice:
//   · pasos 1–4  → SESIONES del sitio público (analytics_events): landing,
//     clic en «Empezar», vista de /signup, envío del formulario;
//   · pasos 5–8  → CLÍNICAS dadas de alta en la ventana (cohorte): alta, primeros
//     pasos hechos (≥1 paciente), checkout iniciado, primer pago.
//
// Los pasos que salen de eventos propios («paso:<nombre>», que manda embudo.ts)
// valen 0 hasta que se despliegue la portada con los botones conectados; la
// tarjeta los marca «sin datos aún» si TODO el bloque de eventos vale 0.
//
// Cross-tenant a propósito: es la vista del dueño de la plataforma, la protege
// el gate de /admin. Nunca lanza: una lectura que falla deja ese paso en null.

export const DIAS_EMBUDO = 30;

export type ClavePasoAdmin =
  | "landing_vista" | "clic_empezar" | "registro_vista" | "registro_enviado"
  | "registro_ok" | "onboarding_completo" | "checkout_iniciado" | "pago_ok";

export const ETIQUETAS_PASO: Record<ClavePasoAdmin, string> = {
  landing_vista: "Vieron la portada",
  clic_empezar: "Tocaron «Empezar»",
  registro_vista: "Abrieron el registro",
  registro_enviado: "Enviaron el formulario",
  registro_ok: "Clínicas creadas",
  onboarding_completo: "Primeros pasos hechos (≥1 paciente)",
  checkout_iniciado: "Iniciaron el pago",
  pago_ok: "Pagaron",
};

export const ORDEN_PASOS: ClavePasoAdmin[] = [
  "landing_vista", "clic_empezar", "registro_vista", "registro_enviado",
  "registro_ok", "onboarding_completo", "checkout_iniciado", "pago_ok",
];

export type ConteosEmbudo = Partial<Record<ClavePasoAdmin, number | null>> & { whatsapp_clic?: number | null };

export interface FilaEmbudo {
  clave: ClavePasoAdmin;
  etiqueta: string;
  /** null = no se pudo leer. */
  total: number | null;
  /** % contra el paso anterior CON dato; null si no aplica. */
  pctAnterior: number | null;
  /** % contra la primera fila con dato. */
  pctInicio: number | null;
}

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Puro: de los conteos a las filas con porcentajes. */
export function armarEmbudo(c: ConteosEmbudo): FilaEmbudo[] {
  let primero: number | null = null;
  let previo: number | null = null;
  return ORDEN_PASOS.map((clave) => {
    const total = c[clave] ?? null;
    let pctAnterior: number | null = null;
    let pctInicio: number | null = null;
    if (total !== null) {
      if (primero === null && total > 0) primero = total;
      if (previo !== null) pctAnterior = pct(total, previo);
      if (primero !== null && total !== primero) pctInicio = pct(total, primero);
      else if (primero !== null) pctInicio = 100;
      previo = total;
    }
    return { clave, etiqueta: ETIQUETAS_PASO[clave], total, pctAnterior, pctInicio };
  });
}

/** ¿Los eventos propios (pasos 2 y 4) todavía no existen? */
export function sinEventosPropios(c: ConteosEmbudo): boolean {
  return (c.clic_empezar ?? 0) === 0 && (c.registro_enviado ?? 0) === 0;
}

export interface DbEmbudo {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

async function uno(db: DbEmbudo, q: () => Promise<{ n: bigint | number }[]>): Promise<number | null> {
  try {
    const r = await q();
    return Number(r?.[0]?.n ?? 0);
  } catch (err) {
    console.warn(`[admin/embudo] lectura fallida: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/** Lee los conteos de la base. Nunca lanza. Máx. 4 consultas en paralelo. */
export async function leerConteosEmbudo(db: DbEmbudo, ahora: Date = new Date()): Promise<ConteosEmbudo> {
  const desde = new Date(ahora.getTime() - DIAS_EMBUDO * 86_400_000);
  const vistas = (path: string) => () => db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "sessionId") AS n FROM analytics_events
    WHERE type = 'pageview' AND path = ${path} AND "createdAt" >= ${desde}
      AND (surface IS NULL OR surface = 'public')`;
  const paso = (nombre: string) => () => db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "sessionId") AS n FROM analytics_events
    WHERE type = 'custom' AND name = ${nombre} AND "createdAt" >= ${desde}`;

  const [landing, clic, regVista, regEnv] = await Promise.all([
    uno(db, vistas("/")), uno(db, paso("paso:clic_empezar")),
    uno(db, vistas("/signup")), uno(db, paso("paso:registro_enviado")),
  ]);
  const [wa, creadas, activadas, checkout, pagaron] = await Promise.all([
    uno(db, paso("paso:whatsapp_clic")),
    uno(db, () => db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM clinics WHERE "createdAt" >= ${desde}`),
    uno(db, () => db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM clinics c WHERE c."createdAt" >= ${desde}
        AND EXISTS (SELECT 1 FROM patients p WHERE p."clinicId" = c.id)`),
    uno(db, () => db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM clinics c WHERE c."createdAt" >= ${desde}
        AND (c."stripeCustomerId" IS NOT NULL OR c."stripeSubscriptionId" IS NOT NULL
             OR c."subscriptionId" IS NOT NULL
             OR EXISTS (SELECT 1 FROM subscription_invoices s WHERE s."clinicId" = c.id))`),
    uno(db, () => db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM clinics c WHERE c."createdAt" >= ${desde}
        AND EXISTS (SELECT 1 FROM subscription_invoices s
                    WHERE s."clinicId" = c.id AND s.status = 'paid' AND s.amount > 0)`),
  ]);
  return {
    landing_vista: landing, clic_empezar: clic, registro_vista: regVista, registro_enviado: regEnv,
    registro_ok: creadas, onboarding_completo: activadas, checkout_iniciado: checkout, pago_ok: pagaron,
    whatsapp_clic: wa,
  };
}
