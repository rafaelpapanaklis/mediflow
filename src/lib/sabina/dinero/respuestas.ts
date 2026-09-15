/**
 * Cómo se le cuenta al usuario lo que contestó un endpoint de dinero.
 *
 * El traductor genérico (`desenlaceDeEndpoint`) convierte cualquier 400 en «el
 * sistema rechazó los datos». Para dinero eso pierde el porqué (MAPA-dinero §0.4):
 * «Confirma la factura antes de registrar pagos», «El monto excede el saldo
 * pendiente» o «Esta factura está cancelada» son todos 400, ya vienen en español
 * y escritos para personas. Aquí se pasan tal cual; solo se traducen los que
 * vienen en código (`patient_not_found`) y la sesión y el permiso, que sí los
 * explica bien el genérico.
 */

import { desenlaceDeEndpoint, type RespuestaEndpoint, type SabinaEjecucion } from "../engine-acciones";

const CODIGOS: Record<string, string> = {
  patient_not_found: "No encuentro esa factura entre las que puedes ver.",
  "Not found": "No encuentro esa factura entre las que puedes ver.",
  Unauthorized: "Se cerró tu sesión. Vuelve a entrar y pídemelo otra vez.",
};

export function errorDelCuerpo(r: RespuestaEndpoint): string {
  const e = (r.cuerpo as { error?: unknown } | null)?.error;
  return typeof e === "string" ? e.trim() : "";
}

/**
 * Un rechazo del endpoint (4xx) con su frase. `prefijo` dice qué NO se hizo:
 * «No se registró el cobro».
 */
export function rechazoDeDinero(r: RespuestaEndpoint, prefijo: string, verbo: string): SabinaEjecucion {
  if (r.status === 401 || r.status === 403) return desenlaceDeEndpoint(r, verbo);
  const error = errorDelCuerpo(r);
  const texto = CODIGOS[error] ?? error;
  if (!texto) return desenlaceDeEndpoint(r, verbo);
  const tipo = r.status === 409 ? "conflicto" : "invalido";
  return { ok: false, tipo, frase: `${prefijo}: ${texto.replace(/\.?$/, ".")}` };
}

/** ¿El endpoint falló de una forma en la que PUDO haber escrito? (5xx, o el handler lanzó). */
export function falloIncierto(status: number): boolean {
  return status === 0 || status >= 500;
}
