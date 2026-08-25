/**
 * Hook para correr las pruebas del vertical INMUEBLES FUERA de Next.
 *
 * POR QUÉ EXISTE: `server-only` no es un paquete instalado — Next lo resuelve
 * con un alias interno (node_modules/next/dist/compiled/server-only). Al
 * importar src/lib/realty/billing.ts desde `node --test`, el require truena
 * con MODULE_NOT_FOUND antes de la primera aserción.
 *
 * Barber tiene el mismo problema y su prueba de cobro referencia un
 * `scripts/barber-test-hook.mjs` que NUNCA se subió al repo: la prueba está
 * escrita pero no se puede correr. Aquí el hook vive dentro del propio
 * __tests__ del vertical para que no se pierda.
 *
 * Se parchea `Module._resolveFilename` y no un hook ESM porque tsx compila el
 * TypeScript a CommonJS: la resolución que falla es la de `require`, y los
 * hooks de módulos ESM no la ven.
 *
 * Uso:
 *   node --import tsx --import ./src/lib/realty/__tests__/offline.mjs \
 *        --test src/lib/realty/__tests__/suscripcion.test.ts
 */
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const VACIO = join(AQUI, "empty.cjs");

const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only" || request === "client-only") return VACIO;
  // Todo lo demás sigue por la cadena (incluido el alias @/* que resuelve tsx).
  return original.call(this, request, ...rest);
};
