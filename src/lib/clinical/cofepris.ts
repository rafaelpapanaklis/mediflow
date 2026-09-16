/**
 * COFEPRIS — grupo real, vigencia legal y folio del recetario oficial.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
 * Hasta el 15-sep-2026 `POST /api/prescriptions` calculaba la vigencia con el
 * `cofeprisGroup` que venía EN EL CUERPO DE LA PETICIÓN, y si el cuerpo traía
 * `expiresAt` lo guardaba tal cual, sin tope. Resultado: un doctor elegía
 * fentanilo (grupo I, 24 h por ley), escribía "31-dic-2028" en el campo
 * Vigencia del modal, dejaba el folio vacío, y la página pública del QR
 * publicaba «✓ Receta válida y vigente» con el nombre de la clínica.
 *
 * La regla legal no puede vivir en el navegador. Vive aquí, y la aplica el
 * servidor sobre el ÚNICO dato que el cliente no puede falsificar: el
 * `cofeprisGroup` del catálogo CUMS (`CumsItem`), que se carga por seed y no
 * se manda por API.
 *
 * `src/lib/sabina/tools/recetas.ts` tiene su propia copia de `rangoGrupo` /
 * `vigenciaMaximaLegal` porque se escribió como defensa DE LECTURA cuando el
 * endpoint todavía era vulnerable. Al unificar hay que tocar ese archivo, y
 * hoy lo están tocando varias ramas de Sabina a la vez; queda anotado como
 * limpieza posterior, no como parte de este arreglo de seguridad.
 */

export const COFEPRIS_GROUPS = ["I", "II", "III", "IV", "V", "VI"] as const;
export type CofeprisGroup = (typeof COFEPRIS_GROUPS)[number];

/**
 * Orden EXPLÍCITO de restricción: I < II < III < IV < V < VI.
 * Explícito y no `sort()` alfabético: que los números romanos del I al VI
 * ordenen bien como texto es una casualidad, no una garantía.
 * 99 = sin grupo o grupo desconocido (no controlado). Menor = más restrictivo.
 */
const RANGOS: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };

export function cofeprisRank(group?: string | null): number {
  return RANGOS[(group ?? "").trim().toUpperCase()] ?? 99;
}

/** Normaliza a "I".."VI"; cualquier otra cosa (incluido vacío) → null. */
export function normalizeCofeprisGroup(group?: string | null): CofeprisGroup | null {
  const key = (group ?? "").trim().toUpperCase();
  return key in RANGOS ? (key as CofeprisGroup) : null;
}

/**
 * El grupo MÁS RESTRICTIVO de una lista (la receta entera se rige por su
 * medicamento más controlado). `null` si ninguno tiene grupo conocido.
 */
export function mostRestrictiveCofeprisGroup(
  groups: Array<string | null | undefined>,
): CofeprisGroup | null {
  let mejor: CofeprisGroup | null = null;
  let mejorRango = 99;
  for (const g of groups) {
    const norm = normalizeCofeprisGroup(g);
    if (!norm) continue;
    const r = cofeprisRank(norm);
    if (r < mejorRango) {
      mejorRango = r;
      mejor = norm;
    }
  }
  return mejor;
}

/**
 * NOM-024: vigencia legal de la receta según grupo COFEPRIS.
 * - Grupo I (estupefacientes):  24 horas
 * - Grupo II (psicotrópicos):   30 días
 * - Grupo III (opioides débiles, antidepresivos): 90 días
 * - Grupo IV-VI / sin grupo:    180 días (default seguro)
 */
export function expiresForCofeprisGroup(group?: string | null, base: Date = new Date()): Date {
  const out = new Date(base);
  switch (normalizeCofeprisGroup(group)) {
    case "I":   out.setHours(out.getHours() + 24); break;
    case "II":  out.setDate(out.getDate() + 30);   break;
    case "III": out.setDate(out.getDate() + 90);   break;
    default:    out.setDate(out.getDate() + 180);  break;
  }
  return out;
}

/**
 * ¿El grupo tiene TOPE DURO de vigencia? Solo I, II y III.
 * Para IV-VI y sin grupo, el médico sigue pudiendo pedir la fecha que quiera:
 * los 180 días son un default prudente, no una obligación legal, y apretarlos
 * rompería recetas comunes (antibióticos, analgésicos) sin ganar nada.
 */
export function hasLegalExpiryCap(group?: string | null): boolean {
  return cofeprisRank(group) <= 3;
}

/**
 * ¿Exige folio del recetario oficial? Grupos I y II (estupefacientes y
 * psicotrópicos): el recetario es numerado y lo entrega la autoridad.
 */
export function requiresCofeprisFolio(group?: string | null): boolean {
  return cofeprisRank(group) <= 2;
}

/**
 * INTERRUPTOR DE PRODUCTO — `RECETAS_FOLIO_OBLIGATORIO`.
 *
 * Exigir folio es lo correcto, pero tiene consecuencia: los doctores que hoy
 * recetan diazepam, clonazepam o codeína sin folio quedan bloqueados el día
 * que esto entre. Por eso la exigencia se puede apagar sin desplegar:
 *
 *     RECETAS_FOLIO_OBLIGATORIO=off     (o 0, false, no)  → no se exige
 *     cualquier otro valor, o sin variable                → se exige
 *
 * El default es EXIGIR: si alguien borra la variable por accidente, el sistema
 * se queda en el lado seguro, no en el permisivo.
 */
const APAGADO = new Set(["0", "false", "off", "no"]);

export function folioObligatorioActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return !APAGADO.has((env.RECETAS_FOLIO_OBLIGATORIO ?? "").trim().toLowerCase());
}

/** Texto para humanos del plazo legal de cada grupo (va en los mensajes de error). */
export function plazoLegalTexto(group?: string | null): string {
  switch (normalizeCofeprisGroup(group)) {
    case "I":   return "24 horas";
    case "II":  return "30 días";
    case "III": return "90 días";
    default:    return "180 días";
  }
}
