// Orthodontics — «Alta del caso» (ws1-t6, Ola 1). Tolerancia a columnas
// nuevas que Rafael aún no pegó en Supabase (sql/ortodoncia-alta-caso.sql):
// P2021 = tabla inexistente, P2022 = columna inexistente. Mismo criterio que
// ya usa el loader de la Ola 0 (redesign/loader.ts:isMissingTableError) —
// aquí vive aparte porque las actions de creación SÍ necesitan reintentar la
// escritura sin el campo nuevo, no solo devolver `null` como una lectura.

export function isMissingColumnError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  return code === "P2021" || code === "P2022";
}
