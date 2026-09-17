// Interruptor del menú de dos niveles (el rediseño del panel), POR CLÍNICA (una
// sede dental es su propia fila de `clinics`, así que apagarlo en una sede lo
// nota todo su equipo).
//
// EL REDISEÑO ES EL PANEL POR DEFECTO (17-sep-2026). Antes era al revés: solo lo
// veía la clínica que tuviera su fila encendida. Hoy lo ve TODA clínica —las que
// ya existen y las que lleguen mañana— salvo que algo diga lo contrario. Y hay
// exactamente dos formas de decir lo contrario, en este orden:
//
//  0. EL APAGADOR GLOBAL, `REDISENO_APAGADO`. Si la variable de entorno está
//     puesta, la respuesta es `false` para TODAS las clínicas sin mirar la base
//     ni la caché. Es el freno de emergencia: se pone en Vercel, se redespliega,
//     y en dos minutos todo el mundo vuelve al panel de siempre sin revertir
//     código ni esperar a que nadie toque SQL. Ver `apagadoGlobalmente`.
//  1. LA FILA DE LA CLÍNICA en `clinic_feature_flags`, que ahora es un APAGADOR:
//     `enabled = false` devuelve al panel de siempre a ESA clínica y solo a ella,
//     sin desplegar nada (tarda el minuto de caché). `enabled = true` y la fila
//     ausente significan lo mismo —encendido—, así que las filas que ya existen
//     (Altabrisa tiene una con `enabled = true`) siguen queriendo decir lo que
//     querían decir: no se invierte ninguna.
//
// Dos reglas que no han cambiado:
//  1. La MISMA respuesta en todas las pantallas. El menú no puede cambiar de
//     forma al navegar: se espera a la base, tarde lo que tarde.
//  2. Ante la duda, el comportamiento NORMAL, que hoy es el rediseño. Si la
//     tabla todavía no existe (falta `sql/menu-dos-niveles.sql`), si no hay
//     clínica, o si la consulta falla sin que sepamos nada de esa clínica, la
//     respuesta es `REDISENO_POR_DEFECTO`. Nunca lanza. Lo que apaga es un
//     `false` explícito —la fila o la variable de entorno—, nunca un fallo.
//     El camino viejo del panel sigue entero en el código: es a donde se vuelve.
//
// ⛔ SIN TOPE DE TIEMPO, a propósito. Hubo uno (1,5 s → menú de siempre) y era
// justo lo que hacía saltar el menú: con `connection_limit=1` todas las consultas
// de una carga van en fila por UNA conexión, así que el reloj medía la espera en
// la fila, no la base. En las pantallas con muchas consultas (Configuración, la
// ficha del paciente) y en la primera carga de cada una perdía contra el tope y
// pintaba el menú viejo; en las ligeras ganaba. Tampoco ahorraba nada: el layout
// espera en el mismo Promise.all a las otras tres consultas, así que el panel no
// sale antes por dejar de esperar a esta. Si la base se cuelga, Prisma corta solo
// (pool_timeout) y cae en el camino de error de abajo.
//
// Cuidados, porque esto corre en CADA carga del panel de TODAS las clínicas:
//  - Antes de leer la fila se pregunta si la tabla existe (to_regclass, que no
//    falla). Sin eso, Prisma escribe un `prisma:error` en el log por cada carga
//    mientras el SQL no esté aplicado, aunque el error se atrape aquí.
//  - La respuesta de cada clínica se guarda 60 s en memoria: una consulta por
//    clínica por minuto, no una por clic. Apagar una clínica tarda ese minuto.
//  - Las cargas simultáneas de una misma clínica comparten UNA consulta.
//  - Si la consulta falla, se sigue dando la ÚLTIMA respuesta buena de esa
//    clínica (un fallo suelto de la base no cambia el menú, ni para encender ni
//    para apagar) y no se vuelve a preguntar en 10 s. Solo sin respuesta previa
//    se cae al valor por defecto.
//  - El apagador global NO toca la caché: cuando se quita la variable, cada
//    clínica sigue con la respuesta que tenía guardada.
//
// Separado del lector con Prisma para poder probarlo sin base de datos.

/** Clave de la fila en `clinic_feature_flags`. */
export const FLAG_MENU_DOS_NIVELES = "menu-dos-niveles";

/**
 * La respuesta cuando NADIE ha dicho lo contrario: el rediseño es el panel
 * normal. Una clínica sin fila lo ve; una clínica nueva lo ve el día que se da
 * de alta, sin que nadie toque la base. Para volver al panel de siempre hay que
 * decirlo a propósito: la fila con `enabled = false` (una clínica) o
 * `REDISENO_APAGADO` (todas).
 */
export const REDISENO_POR_DEFECTO = true;

/** Variable de entorno del apagador global. Se pone en Vercel y se redespliega. */
export const ENV_APAGADO_GLOBAL = "REDISENO_APAGADO";

// Con qué valores NO se apaga. Todo lo demás —"1", "true", "si", "on", "x"— sí
// apaga: esto es un freno de emergencia y se tira de él con prisa, así que se
// perdona la forma de escribirlo. Lo que NO puede pasar es lo contrario: que
// Rafael lo ponga en Vercel, redespliegue, y las clínicas sigan con el rediseño
// porque escribió la palabra que este archivo no esperaba.
const NO_APAGAN = new Set(["", "0", "false", "no", "off"]);

/**
 * ¿Está echado el freno de emergencia? Se lee en CADA llamada (no al cargar el
 * módulo): así un test puede ponerla y quitarla, y un proceso que ya está vivo
 * la ve en cuanto el entorno cambia. En Vercel el cambio llega con el
 * redespliegue, que es justo el camino de dos minutos que esto existe para dar.
 */
export function apagadoGlobalmente(env: Record<string, string | undefined> = process.env): boolean {
  const valor = env[ENV_APAGADO_GLOBAL];
  if (typeof valor !== "string") return false;
  return !NO_APAGAN.has(valor.trim().toLowerCase());
}

export type LeerFilaInterruptor = (
  clinicId: string,
) => Promise<{ enabled: boolean } | null | undefined>;

export interface DependenciasInterruptor {
  /** ¿Existe la tabla? Debe responder sin lanzar cuando no existe. */
  tablaExiste: () => Promise<boolean>;
  leer: LeerFilaInterruptor;
  ahora?: () => number;
  /** Cuánto vale una respuesta buena (también el reintento de «no hay tabla»). */
  ttlMs?: number;
  /** Pausa antes de reintentar una clínica tras un fallo. */
  reintentoMs?: number;
  /** El apagador global. Por defecto, la variable de entorno. Inyectable para probarlo. */
  apagadoGlobal?: () => boolean;
}

const MAX_CLINICAS_EN_MEMORIA = 5000;

export function crearInterruptor(dep: DependenciasInterruptor) {
  const ahora = dep.ahora ?? Date.now;
  const ttlMs = dep.ttlMs ?? 60_000;
  const reintentoMs = dep.reintentoMs ?? 10_000;
  const apagadoGlobal = dep.apagadoGlobal ?? (() => apagadoGlobalmente());
  let tabla: { existe: boolean; at: number } | null = null;
  // `valor` es siempre la última respuesta BUENA de la base para esa clínica
  // (o `REDISENO_POR_DEFECTO` si nunca la hubo); `hasta` dice cuándo volver a
  // preguntar. El apagador global NO entra aquí: no se guarda ni se lee.
  const guardadas = new Map<string, { valor: boolean; hasta: number }>();
  const enVuelo = new Map<string, Promise<boolean>>();

  const guardar = (clinicId: string, valor: boolean, hasta: number) => {
    if (guardadas.size >= MAX_CLINICAS_EN_MEMORIA && !guardadas.has(clinicId)) {
      // Fuera la más antigua (un Map recuerda el orden en que se metieron), no
      // todas: vaciar el mapa entero dejaría a 5000 clínicas sin respuesta
      // guardada a la vez y la siguiente carga de cada una iría a la base.
      const masVieja = guardadas.keys().next();
      if (!masVieja.done) guardadas.delete(masVieja.value);
    }
    guardadas.set(clinicId, { valor, hasta });
  };

  const consultar = async (clinicId: string, t: number): Promise<boolean> => {
    if (!tabla || (!tabla.existe && t - tabla.at >= ttlMs)) {
      tabla = { existe: await dep.tablaExiste(), at: t };
    }
    // Sin tabla no hay forma de que nadie haya dicho «apágalo»: comportamiento
    // normal. Mientras el SQL no esté aplicado, todas las clínicas ven el
    // rediseño, que es exactamente lo que se quiere que vean.
    if (!tabla.existe) return REDISENO_POR_DEFECTO;
    const fila = await dep.leer(clinicId);
    // La fila es el APAGADOR: solo un `enabled = false` explícito apaga. Sin
    // fila (la inmensa mayoría de las clínicas) y con `enabled = true` (las
    // filas que ya existían, como la de Altabrisa) la respuesta es la misma,
    // encendido: ninguna fila de las de hoy cambia de significado.
    return fila?.enabled !== false;
  };

  const resolver = async (clinicId: string, t: number): Promise<boolean> => {
    try {
      const resultado = await consultar(clinicId, t);
      guardar(clinicId, resultado, t + ttlMs);
      return resultado;
    } catch (err) {
      const previa = guardadas.get(clinicId)?.valor ?? REDISENO_POR_DEFECTO;
      const code = (err as { code?: string } | null)?.code;
      console.warn(
        `[menu-dos-niveles] no se pudo leer el interruptor; se mantiene la última respuesta (${previa})`,
        code ?? err,
      );
      guardar(clinicId, previa, t + reintentoMs);
      return previa;
    }
  };

  return function encendido(clinicId: string | null | undefined): Promise<boolean> {
    // ANTES QUE NADA el freno de emergencia: ni base, ni caché, ni clínica.
    // Devuelve el panel de siempre a TODAS y no deja rastro en la caché, así que
    // quitar la variable las devuelve a donde estaban.
    if (apagadoGlobal()) return Promise.resolve(false);

    // Sin clínica no se consulta: un `clinicId: undefined` en Prisma no filtra.
    // Sigue sin consultarse, pero la respuesta ya no es «el menú de siempre»:
    // nadie ha dicho que se apague, así que vale lo normal. En la práctica no
    // pasa —`clinicId` es `string` en la sesión (src/lib/auth.ts)—; esto es la
    // red por si alguien llama desde otro sitio.
    if (typeof clinicId !== "string" || clinicId.trim() === "") {
      return Promise.resolve(REDISENO_POR_DEFECTO);
    }

    const t = ahora();
    const previa = guardadas.get(clinicId);
    if (previa && t < previa.hasta) return Promise.resolve(previa.valor);

    const pendiente = enVuelo.get(clinicId);
    if (pendiente) return pendiente;

    const promesa = resolver(clinicId, t).finally(() => enVuelo.delete(clinicId));
    enVuelo.set(clinicId, promesa);
    return promesa;
  };
}
