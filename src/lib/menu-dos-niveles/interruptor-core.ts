// Interruptor del menú de dos niveles, POR CLÍNICA (una sede dental es su propia
// fila de `clinics`, así que encenderlo en una sede lo ve todo su equipo).
//
// Dos reglas, en este orden:
//  1. La MISMA respuesta en todas las pantallas. El menú no puede cambiar de
//     forma al navegar: si la clínica lo tiene encendido y la base contesta, sale
//     el menú nuevo, tarde lo que tarde en contestar.
//  2. Ante la duda, el menú de siempre. Si la tabla todavía no existe (falta
//     `sql/menu-dos-niveles.sql`), si no hay clínica, o si la consulta falla sin
//     que sepamos nada de esa clínica, la respuesta es `false` y el panel se pinta
//     exactamente como hoy. Nunca lanza.
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
//    clínica por minuto, no una por clic. Apagar el menú tarda ese minuto.
//  - Las cargas simultáneas de una misma clínica comparten UNA consulta.
//  - Si la consulta falla, se sigue dando la ÚLTIMA respuesta buena de esa
//    clínica (un fallo suelto de la base no cambia el menú) y no se vuelve a
//    preguntar en 10 s. Solo sin respuesta previa se cae al menú de siempre.
//
// Separado del lector con Prisma para poder probarlo sin base de datos.

/** Clave de la fila en `clinic_feature_flags`. */
export const FLAG_MENU_DOS_NIVELES = "menu-dos-niveles";

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
}

const MAX_CLINICAS_EN_MEMORIA = 5000;

export function crearInterruptor(dep: DependenciasInterruptor) {
  const ahora = dep.ahora ?? Date.now;
  const ttlMs = dep.ttlMs ?? 60_000;
  const reintentoMs = dep.reintentoMs ?? 10_000;
  let tabla: { existe: boolean; at: number } | null = null;
  // `valor` es siempre la última respuesta BUENA de la base para esa clínica
  // (o `false` si nunca la hubo); `hasta` dice cuándo volver a preguntar.
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
    if (!tabla.existe) return false;
    const fila = await dep.leer(clinicId);
    return fila?.enabled === true;
  };

  const resolver = async (clinicId: string, t: number): Promise<boolean> => {
    try {
      const resultado = await consultar(clinicId, t);
      guardar(clinicId, resultado, t + ttlMs);
      return resultado;
    } catch (err) {
      const previa = guardadas.get(clinicId)?.valor ?? false;
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
    // Sin clínica no se consulta: un `clinicId: undefined` en Prisma no filtra.
    if (typeof clinicId !== "string" || clinicId.trim() === "") return Promise.resolve(false);

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
