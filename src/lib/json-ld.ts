// ─────────────────────────────────────────────────────────────────────────────
// Serializador ÚNICO de JSON-LD para `<script type="application/ld+json">`.
//
// Por qué: la inyección cruda (`dangerouslySetInnerHTML`) es el patrón oficial
// de Next para JSON-LD, pero `JSON.stringify` NO escapa `<`. Un nombre de
// clínica con `</script><script>…` cierra el bloque y ejecuta código en la
// página pública (A1, auditoría 30-sep-2026). Todo JSON-LD del sitio pasa por
// aquí; ningún `<script type="application/ld+json">` usa JSON.stringify a pelo.
//
// Se escapan a su forma `\uXXXX` (JSON válido que cualquier parser lee igual):
//   `<`  → cierra `</script>` y abre `<!--`
//   `>`  → cierra `-->`
//   `&`  → entidades (defensa en profundidad con parsers XML)
//   U+2028 / U+2029 → separadores de línea que rompían JS antiguo
// ─────────────────────────────────────────────────────────────────────────────

export function serializeJsonLd(data: unknown): string {
  const json = JSON.stringify(data) ?? "null";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
