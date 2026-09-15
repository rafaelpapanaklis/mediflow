// Interruptor del menú de dos niveles, POR CLÍNICA (una sede dental es su propia
// fila de `clinics`, así que encenderlo en una sede lo ve todo su equipo).
//
// Regla que manda sobre todo lo demás: ante la duda, el menú de siempre. Si la
// tabla todavía no existe (falta `sql/menu-dos-niveles.sql`), si la consulta
// falla o tarda más de la cuenta, o si no hay clínica, la respuesta es `false`
// y el panel se pinta exactamente como hoy. Nunca lanza.
//
// Cuidados, porque esto corre en CADA carga del panel de TODAS las clínicas:
//  - Antes de leer la fila se pregunta si la tabla existe (to_regclass, que no
//    falla). Sin eso, Prisma escribe un `prisma:error` en el log por cada carga
//    mientras el SQL no esté aplicado, aunque el error se atrape aquí.
//  - La respuesta de cada clínica se guarda 60 s en memoria: una consulta por
//    clínica por minuto, no una por clic. Apagar el menú tarda ese minuto.
//  - Un tope de tiempo: si la base tarda, el panel no espera por el menú.
//  - Tras un fallo o un tope, esa clínica no se vuelve a consultar en 10 s, y
//    las cargas simultáneas de una misma clínica comparten UNA consulta. Una
//    consulta que pierde contra el tope sigue viva hasta que la base responde
//    (Prisma no se puede cancelar); sin esta pausa, con la base lenta cada carga
//    abriría otra más y empeoraría justo lo que la hizo lenta.
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
  /** Pausa antes de reintentar una clínica tras un fallo o un tope. */
  reintentoMs?: number;
  /** Tope de espera por la base; pasado, menú de siempre. */
  limiteMs?: number;
}

const AGOTADO = Symbol("agotado");
const MAX_CLINICAS_EN_MEMORIA = 5000;

export function crearInterruptor(dep: DependenciasInterruptor) {
  const ahora = dep.ahora ?? Date.now;
  const ttlMs = dep.ttlMs ?? 60_000;
  const reintentoMs = dep.reintentoMs ?? 10_000;
  const limiteMs = dep.limiteMs ?? 1500;
  let tabla: { existe: boolean; at: number } | null = null;
  const guardadas = new Map<string, { valor: boolean; hasta: number }>();
  const enVuelo = new Map<string, Promise<boolean>>();

  const guardar = (clinicId: string, valor: boolean, hasta: number) => {
    if (guardadas.size >= MAX_CLINICAS_EN_MEMORIA) guardadas.clear();
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
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const resultado = await Promise.race([
        consultar(clinicId, t),
        new Promise<typeof AGOTADO>((resolve) => {
          temporizador = setTimeout(() => resolve(AGOTADO), limiteMs);
        }),
      ]);
      if (resultado === AGOTADO) {
        console.warn(`[menu-dos-niveles] el interruptor tardó más de ${limiteMs} ms; menú de siempre`);
        guardar(clinicId, false, t + reintentoMs);
        return false;
      }
      guardar(clinicId, resultado, t + ttlMs);
      return resultado;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      console.warn("[menu-dos-niveles] no se pudo leer el interruptor; menú de siempre", code ?? err);
      guardar(clinicId, false, t + reintentoMs);
      return false;
    } finally {
      if (temporizador) clearTimeout(temporizador);
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
