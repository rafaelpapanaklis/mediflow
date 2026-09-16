// Guardar y leer el menú personal de una persona, sin saber de Prisma.
//
// Reglas que manda esta capa, y por las que existe separada (se prueba sin base
// de datos):
//
//  · SIN LA TABLA NO SE CAE NADA. Mientras `sql/menu-personalizado.sql` no esté
//    aplicado, leer devuelve «no disponible» y el panel pinta el menú de
//    fábrica; la opción «Personalizar» ni se enseña. Guardar responde
//    «no-disponible», nunca revienta.
//  · LA BASE LENTA NO CUELGA EL PANEL. La lectura tiene tope; pasado, menú de
//    fábrica en esa carga.
//  · DOS PESTAÑAS NO SE PISAN. Cada guardado lleva la `revision` sobre la que se
//    editó. Si en la base hay otra, el guardado NO se aplica: se responde
//    «conflicto» con lo que hay ahora para que la pantalla decida. La revisión
//    es un valor nuevo e irrepetible en cada escritura (no un contador), así que
//    borrar y volver a crear tampoco deja pasar un guardado viejo.
//  · NUNCA SE ESCRIBE A MEDIAS: el diseño entero es UNA fila. O queda el nuevo
//    completo, o se queda el anterior completo.

import { normalizarDiseno, type DisenoMenu } from "./diseno";

export interface FilaMenu {
  layout: unknown;
  revision: string;
}

export interface DependenciasAlmacen {
  /** ¿Existe la tabla? Tiene que responder sin lanzar cuando no existe. */
  tablaExiste: () => Promise<boolean>;
  leerFila: (userId: string, clinicId: string) => Promise<FilaMenu | null | undefined>;
  /** Filas creadas: 0 si ya había una (otra pestaña se adelantó). */
  crearFila: (userId: string, clinicId: string, layout: DisenoMenu, revision: string) => Promise<number>;
  /** Filas cambiadas: 0 si la revisión esperada ya no es la de la base. */
  actualizarFila: (
    userId: string,
    clinicId: string,
    layout: DisenoMenu,
    revision: string,
    revisionEsperada: string,
  ) => Promise<number>;
  borrarFila: (userId: string, clinicId: string) => Promise<void>;
  nuevaRevision?: () => string;
  ahora?: () => number;
  /** Cuánto se recuerda que la tabla NO existe antes de volver a preguntar. */
  ttlTablaMs?: number;
  /** Tope de espera de la lectura. Pasado: menú de fábrica en esa carga. */
  limiteMs?: number;
}

export interface LecturaMenu {
  /** false = la tabla no existe o la base no respondió: ni se ofrece personalizar. */
  disponible: boolean;
  diseno: DisenoMenu | null;
  revision: string | null;
}

export type ResultadoGuardado =
  | { ok: true; revision: string }
  | { ok: false; motivo: "conflicto"; actual: LecturaMenu }
  | { ok: false; motivo: "no-disponible" }
  | { ok: false; motivo: "error" };

const AGOTADO = Symbol("agotado");
const SIN_MENU: LecturaMenu = { disponible: false, diseno: null, revision: null };

function revisionPorDefecto(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** `clinicId: undefined` en Prisma NO filtra: sin los dos ids no se consulta. */
function idsValidos(userId: unknown, clinicId: unknown): boolean {
  return typeof userId === "string" && userId !== "" && typeof clinicId === "string" && clinicId !== "";
}

export function crearAlmacen(dep: DependenciasAlmacen) {
  const ahora = dep.ahora ?? Date.now;
  const ttlTablaMs = dep.ttlTablaMs ?? 60_000;
  const limiteMs = dep.limiteMs ?? 1500;
  const nuevaRevision = dep.nuevaRevision ?? revisionPorDefecto;
  let tabla: { existe: boolean; at: number } | null = null;

  async function hayTabla(): Promise<boolean> {
    const t = ahora();
    // Que exista se recuerda para siempre; que no exista, un minuto (para que
    // el día que Rafael aplique el SQL no haya que reiniciar nada).
    if (tabla && (tabla.existe || t - tabla.at < ttlTablaMs)) return tabla.existe;
    tabla = { existe: await dep.tablaExiste(), at: t };
    return tabla.existe;
  }

  async function leerCrudo(userId: string, clinicId: string): Promise<LecturaMenu> {
    if (!(await hayTabla())) return SIN_MENU;
    const fila = await dep.leerFila(userId, clinicId);
    if (!fila) return { disponible: true, diseno: null, revision: null };
    // Un JSON que no cuadre (formato viejo, edición a mano) no rompe el menú:
    // se trata como «sin personalizar», y el primer guardado lo deja bien.
    return { disponible: true, diseno: normalizarDiseno(fila.layout), revision: fila.revision };
  }

  async function leer(userId: string, clinicId: string): Promise<LecturaMenu> {
    if (!idsValidos(userId, clinicId)) return SIN_MENU;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const resultado = await Promise.race([
        leerCrudo(userId, clinicId),
        new Promise<typeof AGOTADO>((resolve) => {
          temporizador = setTimeout(() => resolve(AGOTADO), limiteMs);
        }),
      ]);
      if (resultado === AGOTADO) {
        console.warn(`[menu-personalizado] la lectura tardó más de ${limiteMs} ms; menú de fábrica`);
        return SIN_MENU;
      }
      return resultado;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      console.warn("[menu-personalizado] no se pudo leer el menú personal; menú de fábrica", code ?? err);
      return SIN_MENU;
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  async function guardar(
    userId: string,
    clinicId: string,
    diseno: DisenoMenu,
    revisionEsperada: string | null,
  ): Promise<ResultadoGuardado> {
    if (!idsValidos(userId, clinicId)) return { ok: false, motivo: "error" };
    try {
      if (!(await hayTabla())) return { ok: false, motivo: "no-disponible" };
      const revision = nuevaRevision();
      const filas =
        revisionEsperada === null
          ? await dep.crearFila(userId, clinicId, diseno, revision)
          : await dep.actualizarFila(userId, clinicId, diseno, revision, revisionEsperada);
      if (filas > 0) return { ok: true, revision };
      // Alguien más (otra pestaña, otro dispositivo) guardó en medio: no se
      // pisa. Se devuelve lo que hay ahora para que la pantalla lo enseñe.
      return { ok: false, motivo: "conflicto", actual: await leer(userId, clinicId) };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // P2021 = la tabla no existe (el SQL aún no está aplicado).
      if (code === "P2021") {
        tabla = { existe: false, at: ahora() };
        return { ok: false, motivo: "no-disponible" };
      }
      console.warn("[menu-personalizado] no se pudo guardar el menú personal", code ?? err);
      return { ok: false, motivo: "error" };
    }
  }

  /** Volver al menú de fábrica: se borra la fila entera. */
  async function borrar(userId: string, clinicId: string): Promise<{ ok: boolean; motivo?: "no-disponible" | "error" }> {
    if (!idsValidos(userId, clinicId)) return { ok: false, motivo: "error" };
    try {
      if (!(await hayTabla())) return { ok: false, motivo: "no-disponible" };
      await dep.borrarFila(userId, clinicId);
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2021") return { ok: false, motivo: "no-disponible" };
      console.warn("[menu-personalizado] no se pudo borrar el menú personal", code ?? err);
      return { ok: false, motivo: "error" };
    }
  }

  return { leer, guardar, borrar };
}
