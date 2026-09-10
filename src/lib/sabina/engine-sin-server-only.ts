/**
 * Deja importar el motor de Sabina desde node:test.
 *
 * `engine.ts` empieza con `import "server-only"`. Ese paquete NO está en
 * node_modules: lo resuelve el propio bundler de Next, así que en Node pelado
 * el import truena con MODULE_NOT_FOUND.
 *
 * Aquí se intercepta la carga y se devuelve un objeto vacío — exactamente lo
 * que hace Next bajo la condición "react-server". No se toca node_modules (está
 * compartido por enlace con las otras terminales) ni se escribe nada en disco.
 *
 * Es una copia del criterio de `src/lib/barber/__tests__/_sin-server-only.ts`,
 * con su propia bandera: vive aquí y no allí porque las rutas de esta tarea son
 * `src/lib/sabina/engine*` y un archivo en la carpeta de barbería sería el diff
 * de otra pantalla.
 *
 * IMPORTAR ESTE ARCHIVO PRIMERO, antes que cualquier módulo del servidor:
 * tsx compila a CJS y los imports se ejecutan en orden.
 */
import Module from "node:module";

const STUBBED = new Set(["server-only", "client-only"]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  __sabinaStubInstalled?: boolean;
};

if (!M.__sabinaStubInstalled) {
  const original = M._load;
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (STUBBED.has(request)) return {};
    return original.call(this, request, parent, isMain);
  };
  M.__sabinaStubInstalled = true;
}

export {};
