/**
 * La cadena de conexión de un cliente de Prisma con su propio tope de conexiones.
 *
 * Cada `new PrismaClient` abre su PROPIO pool, de hasta `connection_limit`
 * conexiones por instancia de función. El incidente del 1-oct-2026 (Supavisor
 * lleno: «EMAXCONN max client connections reached, limit: 200») contó con dos
 * clientes por función —`prisma` y `prismaAdmin`— y cada uno con el límite de
 * DATABASE_URL. `prismaAdmin` solo atiende la analítica (ingesta de /api/track,
 * identidad, /admin/analytics y su cron de retención): le basta una conexión.
 *
 * Se deriva de DATABASE_URL reemplazando (o añadiendo) los parámetros, sin
 * variable nueva. El resto de la cadena —usuario, contraseña, host,
 * `pgbouncer=true`…— se copia tal cual, sin decodificar ni volver a codificar.
 */
export function urlConTopeDeConexiones(
  url: string | undefined,
  tope: { conexiones: number; esperaSegundos: number },
): string | undefined {
  if (!url) return undefined;
  const corte = url.indexOf("?");
  const base = corte === -1 ? url : url.slice(0, corte);
  const consulta = corte === -1 ? "" : url.slice(corte + 1);
  const propios: Record<string, string> = {
    connection_limit: String(tope.conexiones),
    pool_timeout: String(tope.esperaSegundos),
  };
  const otros = consulta
    .split("&")
    .filter((par) => par !== "" && !Object.prototype.hasOwnProperty.call(propios, par.split("=")[0]));
  const nuevos = Object.keys(propios).map((k) => `${k}=${propios[k]}`);
  return `${base}?${otros.concat(nuevos).join("&")}`;
}
