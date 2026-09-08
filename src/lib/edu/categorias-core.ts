/**
 * DaleControl INSTITUCIONAL — LA CATEGORÍA DE PROCEDIMIENTO COMO ENTIDAD ·
 * la parte PURA (H-90).
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only".
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (H-90)
 *
 * «Un requisito por CATEGORÍA es texto libre sin llave. Renombrar la
 * categoría en el catálogo pone el avance a cero EN SILENCIO para toda la
 * especialidad. Y un dedazo al capturarlo cuenta 0 desde el primer día,
 * sin que la pantalla distinga "0 porque nadie lo ha hecho" de "0 porque
 * la categoría no existe".»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTO NO SUSTITUYE AL TEXTO LIBRE, Y NO ES INDECISIÓN.
 *
 * `EduProcedure.category` y `EduRequirement.category` se quedan
 * EXACTAMENTE como están: no se renombran, no se borran, no se migran. La
 * llave (`categoryId`) se pone al lado.
 *
 * Migrar el texto a la llave no lo puede hacer un `.sql`: cada escuela
 * agrupa distinto y NADIE puede adivinar si «Endodoncia», «endodoncias» y
 * «ENDO» son la misma categoría o tres. Lo que sí se puede hacer es
 * PROPONER el emparejamiento y que una persona lo confirme — que es lo que
 * hace `eduCategoriaSugerirEmparejado` aquí abajo, y es una sugerencia,
 * nunca una escritura.
 *
 * 🔴 UNA CATEGORÍA NO SE BORRA: se desactiva, como los sillones, las
 * especialidades y las sedes. Y los dos `categoryId` van con SetNull:
 * desactivar una categoría no puede vaciar el tarifario.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { eduNormalizeSearch } from "@/lib/edu/search";

export const EDU_CATEGORIA_NAME_MAX = 60;
export const EDU_CATEGORIA_KEY_MAX = 40;
/** Tope de categorías por instituto. Cuarenta ya es un catálogo enorme. */
export const EDU_CATEGORIA_MAX_ROWS = 100;

/**
 * La CLAVE a partir del nombre: minúsculas, sin acentos, con guiones.
 *
 * 🔴 LA CLAVE ES LO QUE NO CAMBIA. Renombrar «Endodoncia» a «Endodoncia y
 * retratamiento» cambia el `name` y deja la `key` («endodoncia») intacta,
 * que es exactamente lo que H-90 pedía: el requisito apunta al id, la
 * pantalla lee el nombre, y renombrar deja de poner nada a cero.
 *
 * Se genera UNA vez, al dar de alta. Editar el nombre NO regenera la
 * clave — si lo hiciera, renombrar volvería a romper lo que esto arregla.
 */
export function eduCategoriaKeyDesdeNombre(nombre: string): string {
  const base = eduNormalizeSearch(nombre)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "categoria").slice(0, EDU_CATEGORIA_KEY_MAX);
}

export function eduCategoriaParseNombre(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < 2) {
    throw new Error("La categoría necesita un nombre («Endodoncia», «Prótesis»).");
  }
  return v.slice(0, EDU_CATEGORIA_NAME_MAX);
}

export function eduCategoriaParseKey(raw: unknown, nombre: string): string {
  if (raw === undefined || raw === null || raw === "") {
    return eduCategoriaKeyDesdeNombre(nombre);
  }
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(v)) {
    throw new Error(
      "La clave de la categoría solo puede llevar minúsculas, números y guiones, y empezar por letra o número.",
    );
  }
  return v.slice(0, EDU_CATEGORIA_KEY_MAX);
}

/**
 * SUGIERE con qué categoría emparejar cada texto libre que ya está en la
 * base. NO escribe nada y NO decide nada.
 *
 * Empareja por el texto normalizado (sin acentos, sin mayúsculas, sin
 * espacios de más), que es lo único que se puede afirmar sin equivocarse.
 * Lo que no empareja sale en `sinPareja` para que una persona lo mire: es
 * mejor una lista de doce cosas que revisar que una migración silenciosa
 * que empareja «Cirugía» con «Cirugía bucal» y pone en cero el avance de
 * una generación.
 */
export function eduCategoriaSugerirEmparejado(
  textosLibres: string[],
  categorias: { id: string; name: string; key: string }[],
): { texto: string; categoryId: string | null }[] {
  const porTexto = new Map<string, string>();
  for (const c of categorias) {
    porTexto.set(eduNormalizeSearch(c.name), c.id);
    porTexto.set(c.key, c.id);
  }
  const vistos = new Set<string>();
  const out: { texto: string; categoryId: string | null }[] = [];
  for (const t of textosLibres) {
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    out.push({ texto: t, categoryId: porTexto.get(eduNormalizeSearch(t)) ?? null });
  }
  return out;
}

/** Las que no encontraron pareja, para la pantalla de revisión. */
export function eduCategoriaSinPareja(
  sugerencias: { texto: string; categoryId: string | null }[],
): string[] {
  return sugerencias.filter((s) => s.categoryId === null).map((s) => s.texto);
}
