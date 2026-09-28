/**
 * Un hallazgo del análisis de IA de una radiografía, y qué de él se dibuja
 * sobre la imagen. Pura, sin React ni CSS: así se puede probar con
 * `node:test` sin arrastrar `xrays-client.tsx` entero (sus imports de
 * `*.module.css` no cargan fuera de Next).
 */
export interface AiFinding {
  id: string;
  title: string;
  description?: string;
  tooth?: string | number;
  severity: "alta" | "media" | "baja" | "informativo";
  confidence?: number;
  /** Posición en % dentro de la imagen para el overlay. Solo si la IA la dio. */
  region?: { x: number; y: number; w: number; h: number };
}

/**
 * Los findings que traen coordenadas REALES — los únicos que el overlay
 * dibuja sobre la radiografía.
 *
 * ANTES: un finding sin `region` recibía una posición de una grilla 4x2 fija
 * y se dibujaba como si la IA hubiera señalado ese punto exacto — engañaba
 * al doctor (parecía que la IA marcó una zona que en realidad no marcó). El
 * modelo (`report_radiograph_analysis`, `api/xrays/[id]/analyze/route.ts`)
 * NUNCA pide ni devuelve coordenadas hoy — solo
 * `id/title/description/tooth/severity/confidence` — así que esa grilla se
 * dibujaba en el 100% de los análisis.
 *
 * AHORA: sin `region`, el finding simplemente no entra aquí — no se dibuja
 * nada sobre la imagen. Sigue apareciendo en la LISTA completa de
 * `xrays-client.tsx` (con su pieza dental si la trae y un aviso discreto de
 * que no tiene ubicación marcada). Si el modelo empieza a devolver `region`
 * algún día, esto lo pinta sin cambiar nada más.
 */
export function findingRegions(
  findings: AiFinding[],
): Array<AiFinding & { region: NonNullable<AiFinding["region"]> }> {
  return findings.filter(
    (f): f is AiFinding & { region: NonNullable<AiFinding["region"]> } => !!f.region,
  );
}
