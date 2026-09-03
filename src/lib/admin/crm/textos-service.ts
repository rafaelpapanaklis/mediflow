// ═══════════════════════════════════════════════════════════════════════
// "MIS TEXTOS" — todo lo que toca la base. Módulo de SERVIDOR.
//
// Ningún componente "use client" puede importar esto: las reglas puras
// —catálogo de huecos, relleno, validación, orden— viven en
// ./textos-core.ts, que sí comparten los dos lados.
//
// ── LA REGLA QUE VIVE AQUÍ Y NO EN LA PANTALLA ─────────────────────────
// SIN LA TABLA, EL CRM SIGUE FUNCIONANDO. `crmTextosListar` devuelve
// { textos: [], falta: true } en vez de lanzar, para que /admin/crm entero
// —tablero, lista, bitácora, importación— siga en pie mientras
// sql/crm-textos.sql no se haya corrido, y sólo la sección de textos diga
// que falta. Es el mismo trato que el badge del menú y que la consulta de
// afiliados del listado: una parte que no se puede leer no puede tumbar la
// pantalla completa.
//
// Las ESCRITURAS sí devuelven error con todas sus letras — guardar algo
// que no se guardó sería peor que no dejar guardar.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import type { CrmResultado } from "./service";
import {
  crmOrdenarTextos,
  crmValidarTexto,
  CRM_TEXTOS_MAX,
  CRM_TEXTO_CUERPO_MAX,
  CRM_TEXTO_TITULO_MAX,
  type CrmTextoDTO,
  type CrmTextoEntrada,
} from "./textos-core";
import { crmEsEtapa, crmEsVertical } from "./crm-core";

export interface CrmTextosListado {
  textos: CrmTextoDTO[];
  /**
   * true = no se pudo leer la tabla; casi siempre porque falta correr
   * sql/crm-textos.sql. La pantalla lo dice con esas palabras en vez de
   * enseñar una lista vacía, que se leería como "todavía no escribes nada".
   */
  falta: boolean;
  /** true cuando ya no se pueden crear más (tope de la libreta). */
  lleno: boolean;
}

function aDTO(t: any): CrmTextoDTO {
  return {
    id: t.id,
    title: t.title,
    body: t.body,
    vertical: t.vertical ?? null,
    stage: t.stage ?? null,
    sortOrder: typeof t.sortOrder === "number" ? t.sortOrder : 0,
    createdByEmail: t.createdByEmail ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Lo que se guarda de verdad: recortado y contra el catálogo. */
function aColumnas(entrada: CrmTextoEntrada): Record<string, any> {
  const datos: Record<string, any> = {};
  if (entrada.title !== undefined) {
    datos.title = String(entrada.title ?? "").trim().slice(0, CRM_TEXTO_TITULO_MAX);
  }
  if (entrada.body !== undefined) {
    // Sólo se recorta el final: los espacios de la izquierda pueden ser
    // sangría a propósito de una lista dentro del mensaje.
    datos.body = String(entrada.body ?? "").replace(/\s+$/, "").slice(0, CRM_TEXTO_CUERPO_MAX);
  }
  if (entrada.vertical !== undefined) {
    datos.vertical = crmEsVertical(entrada.vertical) ? entrada.vertical : null;
  }
  if (entrada.stage !== undefined) {
    datos.stage = crmEsEtapa(entrada.stage) ? entrada.stage : null;
  }
  return datos;
}

// ── Lectura ─────────────────────────────────────────────────────────────

/**
 * Toda la libreta, en su orden. No hay paginación a propósito: son los
 * textos de una persona, el tope es CRM_TEXTOS_MAX y la pantalla los
 * necesita todos para agruparlos por giro y para sugerir los que le quedan
 * al prospecto abierto.
 */
export async function crmTextosListar(): Promise<CrmTextosListado> {
  try {
    const filas = await prisma.crmTemplate.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      take: CRM_TEXTOS_MAX,
    });
    const textos = crmOrdenarTextos(filas.map(aDTO));
    return { textos, falta: false, lleno: textos.length >= CRM_TEXTOS_MAX };
  } catch (e) {
    // El motivo casi seguro: sql/crm-textos.sql todavía no se aplicó.
    console.error("[crm/textos] no se pudo leer la libreta de textos:", e);
    return { textos: [], falta: true, lleno: false };
  }
}

// ── Escritura ───────────────────────────────────────────────────────────

export async function crmTextoCrear(
  entrada: CrmTextoEntrada,
  autorEmail: string | null,
): Promise<CrmResultado<CrmTextoDTO>> {
  const invalido = crmValidarTexto(entrada);
  if (invalido) return { ok: false, error: invalido };

  try {
    const cuantos = await prisma.crmTemplate.count();
    if (cuantos >= CRM_TEXTOS_MAX) {
      return {
        ok: false,
        error: `Ya hay ${CRM_TEXTOS_MAX} textos guardados. Borra alguno que ya no uses antes de escribir otro.`,
      };
    }

    // Nace ARRIBA de todo (sortOrder = el mínimo menos uno) y no al final:
    // el texto que se acaba de escribir es el que se está por usar, y
    // buscarlo hasta el fondo de la lista sería absurdo. Los negativos son
    // perfectamente válidos y el reordenado los normaliza en cuanto
    // alguien mueve algo.
    const primero = await prisma.crmTemplate.findFirst({
      orderBy: { sortOrder: "asc" },
      select: { sortOrder: true },
    });

    const datos = aColumnas(entrada);
    datos.sortOrder = (primero?.sortOrder ?? 0) - 1;
    datos.createdByEmail = autorEmail ?? null;

    const creado = await prisma.crmTemplate.create({ data: datos as any });
    return { ok: true, datos: aDTO(creado), mensaje: `"${creado.title}" quedó guardado.` };
  } catch (e) {
    console.error("[crm/textos] no se pudo crear:", e);
    return { ok: false, error: faltaLaTabla(e) };
  }
}

export async function crmTextoActualizar(
  id: string,
  entrada: CrmTextoEntrada,
): Promise<CrmResultado<CrmTextoDTO>> {
  if (!id) return { ok: false, error: "Falta el texto." };

  try {
    const actual = await prisma.crmTemplate.findUnique({ where: { id } });
    if (!actual) return { ok: false, error: "Ese texto ya no existe." };

    // Se valida la MEZCLA, no sólo lo que llegó: un guardado parcial que
    // borre el título tiene que fallar aquí y no dejar una fila sin él.
    const invalido = crmValidarTexto({
      title: entrada.title ?? actual.title,
      body: entrada.body ?? actual.body,
      vertical: entrada.vertical === undefined ? actual.vertical : entrada.vertical,
      stage: entrada.stage === undefined ? actual.stage : entrada.stage,
    });
    if (invalido) return { ok: false, error: invalido };

    const guardado = await prisma.crmTemplate.update({
      where: { id },
      data: aColumnas(entrada) as any,
    });
    return { ok: true, datos: aDTO(guardado), mensaje: "Guardado." };
  } catch (e) {
    console.error("[crm/textos] no se pudo actualizar:", e);
    return { ok: false, error: faltaLaTabla(e) };
  }
}

export async function crmTextoEliminar(id: string): Promise<CrmResultado> {
  if (!id) return { ok: false, error: "Falta el texto." };
  try {
    const t = await prisma.crmTemplate.findUnique({ where: { id }, select: { title: true } });
    if (!t) return { ok: false, error: "Ese texto ya no existe." };
    await prisma.crmTemplate.delete({ where: { id } });
    return { ok: true, mensaje: `Se borró "${t.title}".` };
  } catch (e) {
    console.error("[crm/textos] no se pudo eliminar:", e);
    return { ok: false, error: faltaLaTabla(e) };
  }
}

/**
 * Reordena la libreta ENTERA: llega la lista de ids en el orden nuevo y se
 * reescribe `sortOrder` de todos.
 *
 * Se reescribe todo y no se intercambian dos valores a propósito: los
 * textos nuevos nacen con el mismo `sortOrder` y con intercambios se
 * saltarían de sitio entre recargas. Va en una transacción para que un
 * fallo a la mitad no deje media libreta en un orden y media en otro.
 *
 * Un id que ya no exista (alguien borró el texto en otra pestaña) se
 * ignora en vez de tumbar la operación: el resto del orden es válido.
 */
export async function crmTextosReordenar(ids: string[]): Promise<CrmResultado> {
  const lista = Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && x) : [];
  if (lista.length === 0) return { ok: false, error: "No llegó ningún orden." };
  if (lista.length > CRM_TEXTOS_MAX) return { ok: false, error: "Llegaron demasiados textos." };

  // Sin repetidos: dos veces el mismo id dejaría el orden a merced de cuál
  // se escribió al final.
  const unicos = Array.from(new Set(lista));

  try {
    await prisma.$transaction(
      unicos.map((id, i) =>
        prisma.crmTemplate.updateMany({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    return { ok: true, mensaje: "Se guardó el orden." };
  } catch (e) {
    console.error("[crm/textos] no se pudo reordenar:", e);
    return { ok: false, error: faltaLaTabla(e) };
  }
}

/**
 * El error que se le enseña a una persona cuando la escritura falla. Si es
 * P2021 (la tabla no existe) se dice con todas sus letras qué hay que
 * correr: es el fallo más probable el primer día y "error inesperado" no
 * ayudaría a nadie a arreglarlo.
 */
function faltaLaTabla(e: unknown): string {
  const codigo = (e as any)?.code;
  if (codigo === "P2021" || codigo === "P2022") {
    return "Falta aplicar sql/crm-textos.sql en Supabase: la tabla de los textos todavía no existe.";
  }
  return "No se pudo guardar. Vuelve a intentarlo.";
}
