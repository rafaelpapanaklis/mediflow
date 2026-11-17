// ═══════════════════════════════════════════════════════════════════════
// Guardia de las pruebas de integración del dinero de barber.
//
// 🔴 ESTAS PRUEBAS CREAN Y BORRAN BARBERÍAS (y una de ellas cambia una
// restricción de la tabla de tickets). Solo corren contra una base LOCAL
// (127.0.0.1 / localhost). Con cualquier otro DATABASE_URL —el de producción,
// el del panel, un staging— se SALTAN: no basta con que la variable exista.
//
// Es la misma guardia que usa el arnés de WhatsApp de ws6-t1
// (_wa-arnes.ts): misma expresión, mismos mensajes.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/<archivo>.test.ts
//
// Puro (sin prisma ni "server-only"): se puede importar antes que nada.
// ═══════════════════════════════════════════════════════════════════════

const URL_DB = process.env.DATABASE_URL ?? "";

/** ¿Esa cadena de conexión apunta a esta misma máquina? */
export function isLocalDatabaseUrl(url: string | null | undefined): boolean {
  return /@(127\.0\.0\.1|localhost)[:/]/.test(url ?? "");
}

/** true = hay base y es local. */
export const BASE_LOCAL = isLocalDatabaseUrl(URL_DB);

/** Motivo para saltarse la integración, o false si se puede correr. */
export const skip: false | string = BASE_LOCAL
  ? false
  : URL_DB
    ? "DATABASE_URL no es local: estas pruebas crean y borran barberías, se saltan"
    : "DATABASE_URL no definido: se salta la integración";

/**
 * Alta de un barbero «de siempre». Renta de silla y sueldo cuentan DESDE EL ALTA
 * (decisión 3 del QA de cierre E, 16-nov-2026): un barbero creado hoy sale
 * proporcional. Las pruebas que hablan del mes completo crean al barbero con
 * este `createdAt`.
 */
export const ALTA_ANTIGUA = new Date("2020-01-01T12:00:00.000Z");
