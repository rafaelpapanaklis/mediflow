/**
 * Deja importar los módulos de servidor de la ola desde node:test.
 *
 * `memberships.ts` y `payments.ts` empiezan con `import "server-only"`. Ese
 * paquete NO está en node_modules: lo resuelve el propio bundler de Next, así
 * que en Node pelado el import truena con MODULE_NOT_FOUND.
 *
 * Aquí se intercepta la carga y se devuelve un objeto vacío — es exactamente
 * lo que hace Next bajo la condición "react-server". No se toca node_modules
 * (está compartido por junction con las otras terminales) ni se escribe nada
 * en disco.
 *
 * IMPORTAR ESTE ARCHIVO PRIMERO, antes que cualquier módulo del servidor:
 * tsx compila a CJS y los imports se ejecutan en orden.
 */
import Module from "node:module";

const STUBBED = new Set(["server-only", "client-only"]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  __barberStubInstalled?: boolean;
};

if (!M.__barberStubInstalled) {
  const original = M._load;
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (STUBBED.has(request)) return {};
    return original.call(this, request, parent, isMain);
  };
  M.__barberStubInstalled = true;
}

export {};
