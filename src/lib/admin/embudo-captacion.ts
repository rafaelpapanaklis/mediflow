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

// ── Por fuente (ws1-t9, punto 2c) ───────────────────────────────────────────
//
// Mismas dos unidades que la tarjeta general, repartidas por FUENTE:
//   · pasos 1–4 → sesiones del sitio público, con la fuente de la SESIÓN
//     (utm_source; si no hay, gclid → «google-ads»; si no, el host del referente;
//     si no, «directo»);
//   · pasos 5–8 → clínicas creadas en la ventana, con el PRIMER UTM guardado al
//     registrarse (clinic_ads_clicks.utmSourceFirst, sql/ws1-t10-meta-origen.sql)
//     o, en su defecto, la plataforma del último clic (google|meta). Si esas
//     columnas aún no existen en la base, todas caen en «sin dato».
// Solo lectura; nunca lanza.

export const FUENTE_DIRECTO = "directo";
export const FUENTE_SIN_DATO = "sin dato";
export const FUENTE_OTRAS = "otras";
const MAX_FUENTES = 8;

/** Normaliza la fuente de una sesión. Puro. */
export function fuenteDeSesion(r: { utmSource?: string | null; gclid?: string | null; referrerHost?: string | null }): string {
  const utm = (r.utmSource ?? "").trim().toLowerCase();
  if (utm) return utm.slice(0, 60);
  if ((r.gclid ?? "").trim()) return "google-ads";
  const host = (r.referrerHost ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (host) return host.slice(0, 60);
  return FUENTE_DIRECTO;
}

/** Normaliza la fuente de una clínica. Puro. */
export function fuenteDeClinica(r: { utmSourceFirst?: string | null; platform?: string | null }): string {
  const utm = (r.utmSourceFirst ?? "").trim().toLowerCase();
  if (utm) return utm.slice(0, 60);
  const p = (r.platform ?? "").trim().toLowerCase();
  if (p === "google") return "google-ads";
  if (p === "meta") return "meta";
  return FUENTE_SIN_DATO;
}

export interface FilaPorFuente {
  fuente: string;
  pasos: Partial<Record<ClavePasoAdmin, number>>;
  /** % de clínicas creadas que pagaron; null si no hay clínicas. */
  pctPago: number | null;
}

type Fuentes = Record<string, number>;

/** Une los conteos por fuente de cada paso; las fuentes menores se agrupan en «otras». Puro. */
export function armarPorFuente(porPaso: Partial<Record<ClavePasoAdmin, Fuentes>>, max: number = MAX_FUENTES): FilaPorFuente[] {
  const acum = new Map<string, Partial<Record<ClavePasoAdmin, number>>>();
  for (const clave of ORDEN_PASOS) {
    for (const [fuente, n] of Object.entries(porPaso[clave] ?? {})) {
      if (!(n > 0)) continue;
      const f = acum.get(fuente) ?? {};
      f[clave] = (f[clave] ?? 0) + n;
      acum.set(fuente, f);
    }
  }
  const peso = (p: Partial<Record<ClavePasoAdmin, number>>) =>
    (p.registro_ok ?? 0) * 1000 + (p.landing_vista ?? 0) + (p.registro_vista ?? 0);
  const ordenadas = [...acum.entries()].sort((a, b) => peso(b[1]) - peso(a[1]) || a[0].localeCompare(b[0]));
  const visibles = ordenadas.slice(0, max);
  const resto = ordenadas.slice(max);
  if (resto.length > 0) {
    const otras: Partial<Record<ClavePasoAdmin, number>> = {};
    for (const [, p] of resto) for (const c of ORDEN_PASOS) if (p[c]) otras[c] = (otras[c] ?? 0) + (p[c] as number);
    visibles.push([FUENTE_OTRAS, otras]);
  }
  return visibles.map(([fuente, pasos]) => ({
    fuente,
    pasos,
    pctPago: (pasos.registro_ok ?? 0) > 0 ? pct(pasos.pago_ok ?? 0, pasos.registro_ok as number) : null,
  }));
}

async function filas<T>(db: DbEmbudo, q: () => Promise<T>): Promise<T | null> {
  try {
    return await q();
  } catch (err) {
    console.warn(`[admin/embudo] lectura por fuente fallida: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/** ¿Existen las columnas de origen de la clínica (utmSourceFirst, platform)? Nunca lanza. */
export async function hayOrigenDeClinica(db: DbEmbudo): Promise<boolean> {
  const r = await filas(db, () => db.$queryRaw<{ n: bigint | number }[]>`
    SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_name = 'clinic_ads_clicks' AND column_name IN ('utmSourceFirst', 'platform')`);
  return Number(r?.[0]?.n ?? 0) >= 2;
}

type CohorteClinicas = "todas" | "activadas" | "checkout" | "pagaron";

/**
 * Clínicas creadas desde `desde` en la cohorte pedida, agrupadas por origen.
 * Dos formas por cohorte (con y sin las columnas de origen): una lectura que
 * nombrara una columna inexistente reventaría con 42703. Mismos criterios que
 * leerConteosEmbudo (los totales por fuente suman los generales).
 */
function consultaClinicas(db: DbEmbudo, desde: Date, conOrigen: boolean, cohorte: CohorteClinicas) {
  type R = { utmSourceFirst: string | null; platform: string | null; n: bigint | number }[];
  if (conOrigen) {
    switch (cohorte) {
      case "todas": return db.$queryRaw<R>`
        SELECT k."utmSourceFirst", k.platform, COUNT(*) AS n
        FROM clinics c LEFT JOIN clinic_ads_clicks k ON k."clinicId" = c.id
        WHERE c."createdAt" >= ${desde} GROUP BY k."utmSourceFirst", k.platform`;
      case "activadas": return db.$queryRaw<R>`
        SELECT k."utmSourceFirst", k.platform, COUNT(*) AS n
        FROM clinics c LEFT JOIN clinic_ads_clicks k ON k."clinicId" = c.id
        WHERE c."createdAt" >= ${desde}
          AND EXISTS (SELECT 1 FROM patients p WHERE p."clinicId" = c.id)
        GROUP BY k."utmSourceFirst", k.platform`;
      case "checkout": return db.$queryRaw<R>`
        SELECT k."utmSourceFirst", k.platform, COUNT(*) AS n
        FROM clinics c LEFT JOIN clinic_ads_clicks k ON k."clinicId" = c.id
        WHERE c."createdAt" >= ${desde}
          AND (c."stripeCustomerId" IS NOT NULL OR c."stripeSubscriptionId" IS NOT NULL
               OR c."subscriptionId" IS NOT NULL
               OR EXISTS (SELECT 1 FROM subscription_invoices s WHERE s."clinicId" = c.id))
        GROUP BY k."utmSourceFirst", k.platform`;
      case "pagaron": return db.$queryRaw<R>`
        SELECT k."utmSourceFirst", k.platform, COUNT(*) AS n
        FROM clinics c LEFT JOIN clinic_ads_clicks k ON k."clinicId" = c.id
        WHERE c."createdAt" >= ${desde}
          AND EXISTS (SELECT 1 FROM subscription_invoices s
                      WHERE s."clinicId" = c.id AND s.status = 'paid' AND s.amount > 0)
        GROUP BY k."utmSourceFirst", k.platform`;
    }
  }
  switch (cohorte) {
    case "todas": return db.$queryRaw<R>`
      SELECT NULL::text AS "utmSourceFirst", NULL::text AS platform, COUNT(*) AS n
      FROM clinics c WHERE c."createdAt" >= ${desde}`;
    case "activadas": return db.$queryRaw<R>`
      SELECT NULL::text AS "utmSourceFirst", NULL::text AS platform, COUNT(*) AS n
      FROM clinics c WHERE c."createdAt" >= ${desde}
        AND EXISTS (SELECT 1 FROM patients p WHERE p."clinicId" = c.id)`;
    case "checkout": return db.$queryRaw<R>`
      SELECT NULL::text AS "utmSourceFirst", NULL::text AS platform, COUNT(*) AS n
      FROM clinics c WHERE c."createdAt" >= ${desde}
        AND (c."stripeCustomerId" IS NOT NULL OR c."stripeSubscriptionId" IS NOT NULL
             OR c."subscriptionId" IS NOT NULL
             OR EXISTS (SELECT 1 FROM subscription_invoices s WHERE s."clinicId" = c.id))`;
    case "pagaron": return db.$queryRaw<R>`
      SELECT NULL::text AS "utmSourceFirst", NULL::text AS platform, COUNT(*) AS n
      FROM clinics c WHERE c."createdAt" >= ${desde}
        AND EXISTS (SELECT 1 FROM subscription_invoices s
                    WHERE s."clinicId" = c.id AND s.status = 'paid' AND s.amount > 0)`;
  }
}

/** Lee el embudo por fuente. Nunca lanza; un paso sin lectura simplemente no aporta filas. 7 consultas máx. en paralelo. */
export async function leerEmbudoPorFuente(db: DbEmbudo, ahora: Date = new Date()): Promise<{ filas: FilaPorFuente[]; origenClinica: boolean }> {
  const desde = new Date(ahora.getTime() - DIAS_EMBUDO * 86_400_000);
  const origenClinica = await hayOrigenDeClinica(db);

  type RowS = { utmSource: string | null; gclid: string | null; referrerHost: string | null; n: bigint | number };
  const vistas = (path: string) => () => db.$queryRaw<RowS[]>`
    SELECT s."utmSource", s.gclid, s."referrerHost", COUNT(DISTINCT e."sessionId") AS n
    FROM analytics_events e JOIN analytics_sessions s ON s.id = e."sessionId"
    WHERE e.type = 'pageview' AND e.path = ${path} AND e."createdAt" >= ${desde}
      AND (e.surface IS NULL OR e.surface = 'public')
    GROUP BY s."utmSource", s.gclid, s."referrerHost"`;
  const paso = (nombre: string) => () => db.$queryRaw<RowS[]>`
    SELECT s."utmSource", s.gclid, s."referrerHost", COUNT(DISTINCT e."sessionId") AS n
    FROM analytics_events e JOIN analytics_sessions s ON s.id = e."sessionId"
    WHERE e.type = 'custom' AND e.name = ${nombre} AND e."createdAt" >= ${desde}
    GROUP BY s."utmSource", s.gclid, s."referrerHost"`;

  const [landing, clic, regVista, regEnv] = await Promise.all([
    filas(db, vistas("/")), filas(db, paso("paso:clic_empezar")),
    filas(db, vistas("/signup")), filas(db, paso("paso:registro_enviado")),
  ]);

  type RowC = { utmSourceFirst: string | null; platform: string | null; n: bigint | number };
  const [creadas, activadas, checkout, pagaron] = await Promise.all([
    filas(db, () => consultaClinicas(db, desde, origenClinica, "todas")),
    filas(db, () => consultaClinicas(db, desde, origenClinica, "activadas")),
    filas(db, () => consultaClinicas(db, desde, origenClinica, "checkout")),
    filas(db, () => consultaClinicas(db, desde, origenClinica, "pagaron")),
  ]);

  const sumarS = (rows: RowS[] | null): Fuentes => {
    const o: Fuentes = {};
    for (const r of rows ?? []) {
      const f = fuenteDeSesion(r);
      o[f] = (o[f] ?? 0) + Number(r.n);
    }
    return o;
  };
  const sumarC = (rows: RowC[] | null): Fuentes => {
    const o: Fuentes = {};
    for (const r of rows ?? []) {
      const f = fuenteDeClinica(r);
      o[f] = (o[f] ?? 0) + Number(r.n);
    }
    return o;
  };
  return {
    origenClinica,
    filas: armarPorFuente({
      landing_vista: sumarS(landing), clic_empezar: sumarS(clic),
      registro_vista: sumarS(regVista), registro_enviado: sumarS(regEnv),
      registro_ok: sumarC(creadas), onboarding_completo: sumarC(activadas),
      checkout_iniciado: sumarC(checkout), pago_ok: sumarC(pagaron),
    }),
  };
}
