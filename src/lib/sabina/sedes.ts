/**
 * 🔴 EL ÚNICO SITIO DONDE SE DECIDE QUÉ SEDES PUEDE MIRAR UNA PERSONA.
 *
 * Todo el panel dental mira UNA clínica y solo una. Esto es la excepción, y una
 * excepción a la regla que protege los datos de todos los clientes se escribe
 * una vez, en un sitio, y se lee entera antes de tocarla. Si te ves calculando
 * "qué sedes puede ver" en otro archivo, párate: va aquí.
 *
 * ── QUÉ ES UNA SEDE EN DENTAL ───────────────────────────────────────────
 * Su PROPIA fila de `Clinic`. No hay columna `parentId` ni "clínica madre" —eso
 * es del vertical barbería (`Barbershop.parentId`), que no aplica aquí—. Lo que
 * une a dos sedes dentales es una PERSONA: el mismo `supabaseId` con una fila
 * `User` en cada una (`@@unique([supabaseId, clinicId])`, una ficha por sede).
 *
 * ── QUIÉN VE MÁS DE UNA, Y POR QUÉ ESE CRITERIO ─────────────────────────
 * Quien tiene FICHA ACTIVA en ella. Ni más ni menos.
 *
 * No es un criterio inventado para esto: es EXACTAMENTE el de `getUserClinics`
 * (@/lib/auth), el switcher de clínica del sidebar, que es la única pantalla que
 * hoy enseña más de una sede. Reusarlo tiene una consecuencia que es el motivo
 * entero de elegirlo:
 *
 *   🔴 ESTO NO ABRE NINGUNA PUERTA NUEVA. Cada número que Sabina enseña de una
 *      sede hermana es un número que esa persona ya podía ver hoy pulsando el
 *      switcher y entrando a esa sede. Lo único que se ahorra es el clic.
 *
 * Esa frase solo es verdad si se respeta TODO lo que hoy corta la entrada a una
 * sede, no solo la ficha. Por eso una sede hermana con el PLAN VENCIDO queda
 * fuera: `getAuthContext` bloquea sus `/api` y el layout la manda a
 * `/dashboard/suspended` (`isPlanExpired`), así que sus números no son «un clic
 * de distancia» — son datos a los que hoy no se llega. Se excluye con la MISMA
 * función que usa el gate, y se DICE cuál quedó fuera; no se calla.
 *
 * Por eso NO se usa `getVisiblePatientClinicIds` (@/lib/branches): ése es otro
 * criterio, para otra cosa. Son los `ClinicPatientLink` que el dueño marca a
 * mano, hoy apagados (`PATIENT_SHARING_ENABLED = false`), y su propio modelo
 * dice que habilitan "solo LECTURA de pacientes; las citas, facturas, pagos,
 * caja y finanzas siguen 100% aisladas por sede". Comparar dinero y agenda con
 * ese permiso sería usarlo para justo lo que declara no cubrir.
 *
 * Tampoco `getOwnedClinicIds` (SUPER_ADMIN): es un subconjunto pensado para el
 * anti-IDOR de la API de vínculos, y usarlo aquí sería un TERCER criterio de
 * "quién ve qué sede" conviviendo con los otros dos. Dos criterios distintos
 * para el mismo permiso es como se abren los agujeros.
 *
 * ── LAS CUATRO INVARIANTES QUE SOSTIENEN ESTO ───────────────────────────
 *  1. NADA entra desde el modelo. Esta función recibe UN argumento, el `ctx` de
 *     la sesión, y no hay ninguna forma de nombrar una sede. No es que el
 *     parámetro se valide: es que el parámetro no existe.
 *  2. El `supabaseId` tampoco viaja en el ctx: se LEE de la fila `User` que la
 *     sesión ya identificó, cotejando `id` Y `clinicId`, los dos de la sesión.
 *  3. La lista NUNCA sale vacía y NUNCA sale sin la sede activa: se construye
 *     empezando por ella, tomada del propio ctx. Ante cualquier duda —no se
 *     resuelve la persona, la ficha activa no aparece en la consulta— se cae a
 *     "solo la activa", que es el comportamiento de hoy y no enseña nada nuevo.
 *  4. Cada sede trae SU ctx, con SU rol, SU override y SU recorte de Sabina.
 *     Ser ADMIN en Altabrisa no da nada en Centro: allí manda la ficha de allí.
 *
 * ── LA SEDE ACTIVA NO SE RECALCULA ──────────────────────────────────────
 * Su ctx es el MISMO objeto que armó `crearSabinaCtx`. No se vuelve a derivar a
 * partir de la base. Así, para quien tiene una sola sede, esto es literalmente
 * el camino de siempre: mismo ctx, mismos permisos, mismos números.
 */

import { DEFAULT_TZ } from "@/lib/agenda/date-ranges";
import { isPlanExpired } from "@/lib/plan-status";
import { leerAjustesSabina, type DbAjustesSabina } from "./ajustes-sabina";
import { overrideDeSabina, permisosDeSabina } from "./permisos-sabina";
import { dbDe, exigirSesion } from "./tools/base";
import type { SabinaCtx } from "./tipos";

/**
 * Cuántas sedes se comparan como mucho.
 *
 * Cada sede cuesta su propia tanda de consultas (~14 con `metrica: "todo"`), y
 * la regla de la casa es menos de 7 por `Promise.all` (el pooler de Supabase se
 * satura). Seis es un tope DE ESTA HERRAMIENTA, no el del plan: `maxClinics`
 * vive en `plan_configs`, se edita sin redeploy y admite ilimitado, así que no
 * se puede derivar de él un número duro. Si alguien tiene más sedes, el recorte
 * se DICE en la respuesta; no se calla.
 */
export const TOPE_SEDES = 6;

/** Cuántos recortes de Sabina se leen a la vez. Menos de 7, regla del pooler. */
const TANDA = 5;

/** Una sede que esta persona sí puede mirar, con el ctx con el que se mira. */
export interface SedeVisible {
  clinicId: string;
  /** El nombre de la clínica. NUNCA un id: quien pregunta no sabe qué es un cuid. */
  nombre: string;
  /** La sede en la que está parada la sesión ahora mismo. */
  esActiva: boolean;
  /**
   * 🔴 El ctx con el que se consulta ESTA sede: su `clinicId`, su `userId` (la
   * ficha de allí) y los permisos de allí. Pasarle este ctx a una herramienta
   * del catálogo es lo que hace que el aislamiento por tenant siga siendo el de
   * siempre: la herramienta no sabe que está comparando nada.
   */
  ctx: SabinaCtx;
}

export interface SedesVisibles {
  /** Siempre al menos una, y la activa siempre la primera. */
  sedes: SedeVisible[];
  /**
   * Cuántas sedes COMPARABLES tiene esta persona, antes del tope: sus fichas
   * activas menos las suspendidas (que van en `vencidas`).
   */
  total: number;
  /**
   * `true` si quedaron sedes fuera de `sedes` —por el tope, o porque no se
   * pudieron resolver—. No afirma la causa: solo que la lista no está completa,
   * que es lo que hay que decirle a quien pregunta.
   */
  truncado: boolean;
  /**
   * Sedes propias que NO se miran porque tienen el plan vencido, por su nombre.
   * Van aparte de `sedes` para poder DECIRLO: callarlas haría creer que esa
   * sede no facturó nada, cuando lo que pasa es que está suspendida.
   */
  vencidas: string[];
}

/** Lo mínimo de una ficha `User` para derivar un ctx de sede. */
interface Ficha {
  clinicId: string;
  userId: string;
  role: string;
  permissionsOverride: string[];
}

/**
 * Las sedes que esta persona puede mirar, cada una con su ctx.
 *
 * 🔴 Un solo argumento, y es el ctx de la sesión. Si algún día alguien le añade
 * un segundo con ids de clínica, esa persona está reabriendo la fuga número uno
 * del repo: no lo hagas.
 */
export async function sedesVisibles(ctx: SabinaCtx): Promise<SedesVisibles> {
  // Corta ANTES de consultar si la sesión viene a medias: con `clinicId`
  // undefined Prisma descarta la clave y devuelve TODAS las clínicas.
  exigirSesion(ctx);

  // La ficha de la sede activa se arma del ctx, no de la base. Es el ancla de
  // la invariante 3: pase lo que pase debajo, la lista empieza por aquí.
  const activa: Ficha = {
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    role: ctx.role,
    permissionsOverride: Array.isArray(ctx.permissionsOverride) ? ctx.permissionsOverride : [],
  };

  // 🔴 Si resolver las hermanas falla por lo que sea —el pooler, una tabla que
  // no está—, la respuesta es «solo tu sede activa». Degradar hacia MENOS sedes
  // es seguro por construcción: es lo que hace el panel hoy. Lo que no se puede
  // es tumbar la pregunta entera por no haber podido mirar la de al lado.
  let hermanas: Ficha[] = [];
  try {
    hermanas = await fichasHermanas(ctx, activa);
  } catch {
    hermanas = [];
  }
  const fichas = [activa, ...hermanas];

  const recortadas = fichas.slice(0, TOPE_SEDES);
  const armadas = await armarSedes(ctx, recortadas);

  // Las suspendidas NO cuentan como sedes comparables: se dicen aparte, por su
  // nombre. Si contaran aquí, el aviso del recorte diría «van 2 de tus 3» y le
  // echaría al tope la culpa de algo que fue el plan vencido — dos avisos para
  // lo mismo, y uno de ellos falso en su causa.
  const total = fichas.length - armadas.vencidas.length;
  return {
    sedes: armadas.sedes,
    total,
    truncado: total > armadas.sedes.length,
    vencidas: armadas.vencidas,
  };
}

/**
 * Las fichas ACTIVAS de la misma persona en OTRAS clínicas.
 *
 * Devuelve `[]` —o sea, "solo tu sede activa"— ante cualquier cosa rara. Aquí
 * fallar cerrado no es una postura defensiva vaga: la lista más estrecha
 * posible es exactamente lo que el panel hace hoy, así que la degradación no se
 * nota y no puede enseñar de más.
 */
async function fichasHermanas(ctx: SabinaCtx, activa: Ficha): Promise<Ficha[]> {
  const db = dbDe(ctx);

  // 🔴 Quién es. El `supabaseId` NO está en el ctx, y no se le añade: se lee de
  // la fila `User` que la sesión ya identificó, cotejando las DOS claves de la
  // sesión (`id` y `clinicId`). Un `userId` suelto no serviría para nada aquí.
  const yo = await db.user.findFirst({
    where: { id: activa.userId, clinicId: activa.clinicId, isActive: true },
    select: { supabaseId: true },
  });
  const supabaseId = typeof yo?.supabaseId === "string" ? yo.supabaseId.trim() : "";
  if (!supabaseId) return [];

  // El criterio, literal: fichas ACTIVAS de esta persona. `isActive` no es
  // decorativo — a quien se le desactiva la ficha de una sede se le está
  // quitando el acceso a esa sede, y la fila sigue ahí.
  const filas = await db.user.findMany({
    where: { supabaseId, isActive: true },
    select: { id: true, clinicId: true, role: true, permissionsOverride: true },
    orderBy: { createdAt: "asc" },
  });

  // Si la ficha activa no sale de esa consulta, la sesión y la base no cuentan
  // lo mismo. No se adivina: se mira solo la sede activa.
  const contieneLaActiva = filas.some(
    (f) => f && f.id === activa.userId && f.clinicId === activa.clinicId,
  );
  if (!contieneLaActiva) return [];

  const vistas: string[] = [activa.clinicId];
  const out: Ficha[] = [];
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const clinicId = typeof f?.clinicId === "string" ? f.clinicId.trim() : "";
    const userId = typeof f?.id === "string" ? f.id.trim() : "";
    const role = typeof f?.role === "string" ? f.role.trim() : "";
    // Sin los tres no hay ctx que armar, y un ctx a medias es la fuga de la
    // regla (c). Se descarta la sede entera antes que consultar con él.
    if (!clinicId || !userId || !role) continue;
    if (vistas.indexOf(clinicId) !== -1) continue;
    vistas.push(clinicId);
    out.push({
      clinicId,
      userId,
      role,
      permissionsOverride: Array.isArray(f.permissionsOverride) ? f.permissionsOverride : [],
    });
  }
  return out;
}

/** Resuelve nombre, zona y permisos de cada ficha, y arma su ctx. */
async function armarSedes(
  ctx: SabinaCtx,
  fichas: Ficha[],
): Promise<{ sedes: SedeVisible[]; vencidas: string[] }> {
  const db = dbDe(ctx);
  const ids = fichas.map((f) => f.clinicId);
  // `ids` nunca está vacío (siempre lleva la activa). El guard está igual
  // porque un `in: []` que alguien convirtiera en `undefined` refactorizando
  // devolvería el sistema entero.
  if (ids.length === 0) return { sedes: [], vencidas: [] };

  const clinicas = await db.clinic.findMany({
    where: { id: { in: ids } },
    // `trialEndsAt` y `subscriptionStatus` son lo que pide `isPlanExpired`: se
    // traen aquí para no tener que volver a la base por cada sede.
    select: {
      id: true,
      name: true,
      timezone: true,
      category: true,
      trialEndsAt: true,
      subscriptionStatus: true,
    },
  });
  const porId: Record<string, any> = {};
  for (let i = 0; i < clinicas.length; i++) {
    if (clinicas[i] && typeof clinicas[i].id === "string") porId[clinicas[i].id] = clinicas[i];
  }

  const out: SedeVisible[] = [];
  const vencidas: string[] = [];
  // En tandas: cada sede hermana cuesta una lectura del recorte de Sabina, y
  // la regla de la casa es menos de 7 consultas por `Promise.all`.
  for (let inicio = 0; inicio < fichas.length; inicio += TANDA) {
    const tanda = fichas.slice(inicio, inicio + TANDA);
    const resueltas = await Promise.all(
      // Si RESOLVER una sede falla (el pooler al leer su recorte de Sabina, por
      // ejemplo), esa sede se cae de la lista y ya está: degradar hacia menos
      // sedes es seguro, y `truncado` hace que se diga que la lista no está
      // completa. Lo que no puede es tumbar la pregunta entera.
      tanda.map((f) =>
        unaSede(ctx, f, porId[f.clinicId], f.clinicId === ctx.clinicId).catch(() => null),
      ),
    );
    for (let i = 0; i < resueltas.length; i++) {
      const r = resueltas[i];
      if (!r) continue;
      if (r.vencida) vencidas.push(r.vencida);
      else if (r.sede) out.push(r.sede);
    }
  }
  return { sedes: out, vencidas };
}

/** Lo que sale de resolver una ficha: una sede mirable, una vencida, o nada. */
interface SedeResuelta {
  sede?: SedeVisible;
  /** El nombre de una sede propia con el plan vencido, para poder decirlo. */
  vencida?: string;
}

/**
 * Una sede, con su ctx. `null` si no se puede nombrar: sin fila de `Clinic` no
 * hay nombre, y enseñar un id en vez del nombre no es una respuesta.
 */
async function unaSede(
  ctx: SabinaCtx,
  ficha: Ficha,
  clinica: any,
  esActiva: boolean,
): Promise<SedeResuelta | null> {
  const nombreCrudo = typeof clinica?.name === "string" ? clinica.name.trim() : "";
  // La activa siempre se puede nombrar de algún modo: quien pregunta sabe en
  // cuál está parado. Una hermana sin nombre no se enseña.
  const nombre = nombreCrudo || (esActiva ? "tu sede" : "");
  if (!nombre) return null;

  // 🔴 LA ACTIVA NO SE RECALCULA. Su ctx es el que armó `crearSabinaCtx`, con
  // el recorte de Sabina ya aplicado. Rebuild aquí sería una segunda forma de
  // calcular lo mismo, y la que se despiste gana.
  //
  // Y NO se le mira el plan, a propósito: si la sede activa estuviera vencida,
  // `getAuthContext` habría cortado la petición mucho antes de llegar aquí, así
  // que comprobarlo sería mover el gate de sitio. Además dejaría la lista sin
  // sede activa, que es una invariante de este archivo.
  if (esActiva) {
    return { sede: { clinicId: ficha.clinicId, nombre, esActiva: true, ctx } };
  }

  // 🔴 EL GATE COMERCIAL, con la MISMA función que usan `getAuthContext` y el
  // layout de /dashboard. Una sede suspendida no se puede abrir desde el panel,
  // así que tampoco se mira desde aquí: si no, esta herramienta sería la única
  // forma de leer una sede a la que hoy no se entra. Se devuelve su nombre para
  // poder decir que existe y que está suspendida.
  if (isPlanExpired(clinica)) {
    return { vencida: nombre };
  }

  // Y para la hermana, el MISMO cálculo que hace `crearSabinaCtx` para la
  // activa, con la ficha de ALLÍ: su rol, su override y el recorte que el
  // Super Admin de ESA sede le puso a Sabina para ESE usuario. Que alguien sea
  // ADMIN aquí no le da nada allí.
  const ajustes = await leerAjustesSabina(ficha.clinicId, ficha.userId, rendijaDeAjustes(ctx));
  const recorte = permisosDeSabina(
    { role: ficha.role, permissionsOverride: ficha.permissionsOverride },
    ajustes,
  );

  const tz = typeof clinica?.timezone === "string" && clinica.timezone.trim() ? clinica.timezone : DEFAULT_TZ;
  return {
    sede: {
      clinicId: ficha.clinicId,
      nombre,
      esActiva: false,
      ctx: {
        clinicId: ficha.clinicId,
        userId: ficha.userId,
        role: ficha.role,
        permissionsOverride: overrideDeSabina(recorte.permitidas),
        sabina: { apagada: recorte.apagada, quitadas: recorte.quitadas },
        timezone: tz,
        clinicCategory: typeof clinica?.category === "string" ? clinica.category : undefined,
        // El MISMO cliente de base que la sede activa. En producción es
        // `undefined` y `dbDe` cae al prisma del repo; en pruebas es el doble, y
        // que se propague es lo que permite demostrar la fuga con un solo doble.
        db: ctx.db,
      },
    },
  };
}

/** El cliente de base visto como la rendija que pide `leerAjustesSabina`. */
function rendijaDeAjustes(ctx: SabinaCtx): DbAjustesSabina {
  return dbDe(ctx) as unknown as DbAjustesSabina;
}
