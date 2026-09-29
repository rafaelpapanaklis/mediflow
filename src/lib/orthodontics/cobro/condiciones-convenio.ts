// ═══════════════════════════════════════════════════════════════════════════
// Condiciones del convenio de pago de ortodoncia (ws1-t4, 29-sep-2026) —
// puro, sin I/O, client-safe.
//
// Decisión de Rafael: DaleControl trae unas condiciones DE EJEMPLO, neutrales
// y cortas, y cada clínica las edita en Ortodoncia → Configuración →
// «Condiciones del convenio». El convenio en PDF imprime las de la clínica.
//
// Las del ejemplo NO ponen montos, intereses ni plazos: eso lo decide cada
// clínica (el recargo por atraso, si lo usa, vive en «Política de cobro» y
// el PDF lo imprime aparte, con sus números reales).
//
// Guardado (`condiciones-convenio-db.ts`):
//   · null  → la clínica nunca las editó: se usa el EJEMPLO.
//   · ""    → la clínica las borró a propósito: el PDF lleva una línea neutra.
//   · texto → las de la clínica, tal cual.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope del texto: sobra para una hoja de condiciones y no deja pegar un contrato entero. */
export const MAX_CONDICIONES_CONVENIO = 6000;

export const CONDICIONES_CONVENIO_EJEMPLO = [
  "Los pagos se realizan en las fechas pactadas en el calendario de este convenio.",
  "Si un pago se atrasa, la clínica se comunicará con el paciente o con el responsable del pago para acordar cómo ponerse al corriente.",
  "La reposición de aparatos rotos o perdidos (brackets, alineadores, retenedores u otros) tiene un costo aparte, salvo las reposiciones incluidas en este plan.",
  "La fase de retención y los retenedores se realizan según lo acordado con el doctor tratante.",
  "Si el tratamiento se suspende o se abandona, el paciente o el responsable del pago debe avisar a la clínica; el saldo pendiente se revisa con la clínica según la atención recibida.",
  "Cualquier cambio al plan de tratamiento o a este convenio se acuerda por escrito entre la clínica y el paciente o el responsable del pago.",
].join("\n");

/** La línea que va cuando la clínica dejó las condiciones en blanco a propósito. */
export const SIN_CONDICIONES_CONVENIO =
  "Las condiciones de este convenio son las acordadas directamente con la clínica.";

/** Limpia lo que escribe la clínica: saltos de línea normalizados, sin espacios colgando, con tope. */
export function normalizarCondicionesConvenio(texto: string): string {
  return String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CONDICIONES_CONVENIO);
}

/**
 * Las condiciones que se imprimen, renglón por renglón (cada renglón no vacío
 * es una cláusula), y si son el ejemplo de DaleControl.
 *
 * Una numeración que la clínica ya haya escrito («1.», «2)», «-», «•») se
 * quita: el PDF numera solo, para que no salga «1. 1. Los pagos…».
 */
export function condicionesParaImprimir(guardadas: string | null | undefined): {
  clausulas: string[];
  esEjemplo: boolean;
} {
  const esEjemplo = guardadas == null;
  const texto = esEjemplo ? CONDICIONES_CONVENIO_EJEMPLO : normalizarCondicionesConvenio(guardadas);
  const clausulas = texto
    .split("\n")
    .map((l) => l.trim().replace(/^(?:\d{1,2}\s*[.)-]|[-•*])\s+/, "").trim())
    .filter(Boolean);
  return { clausulas: clausulas.length > 0 ? clausulas : [SIN_CONDICIONES_CONVENIO], esEjemplo };
}
