/**
 * ¿Esta petición es una SERVER ACTION? Misma regla que Next 16
 * (getServerActionRequestMetadata en next/dist/server/lib/server-action-request-meta):
 * POST con cabecera `next-action` (la que manda el cliente de React) o un POST de
 * formulario (multipart/form-data o urlencoded), que es como llega una action sin
 * JavaScript, SIN esa cabecera. Desde headers() no se ve el método; un GET con
 * esos content-type no es una navegación normal, así que tratarlo como action
 * solo puede cortar de más a quien lo fabrica, nunca de menos.
 *
 * Sirve para decidir SI se corta (plan vencido, ws1-t11 · lead 11): por eso no
 * basta con la cabecera, que el cliente puede quitar.
 */
export type PeticionDeAction = false | "cabecera" | "formulario";

/**
 * "cabecera": trae `next-action` — una action de verdad; ninguna ruta /api la
 * recibe nunca. "formulario": POST de formulario sin cabecera — puede ser una
 * action sin JavaScript o una subida normal a una ruta /api (eso lo decide la
 * ruta). false: lo demás (GET de página, JSON a /api…).
 */
export function esPeticionDeServerAction(h: { get(nombre: string): string | null }): PeticionDeAction {
  if (h.get("next-action")) return "cabecera";
  const tipo = (h.get("content-type") ?? "").trim().toLowerCase();
  return tipo.startsWith("multipart/form-data") || tipo.startsWith("application/x-www-form-urlencoded")
    ? "formulario"
    : false;
}
