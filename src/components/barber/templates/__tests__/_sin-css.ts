/**
 * Deja importar el registro de plantillas (../index.tsx) desde node:test.
 *
 * `index.tsx` hace `import "./skins.css"` para que la piel viaje con las
 * plantillas. En Next eso lo resuelve el bundler; en Node pelado, `require`
 * intenta leer el CSS como JavaScript y truena con `SyntaxError: Unexpected
 * token '.'` en la primera regla. Por eso la prueba del horario importaba
 * las plantillas UNA POR UNA, con una tabla escrita a mano que había que
 * tocar cada vez que nacía una plantilla — justo el olvido que estas pruebas
 * quieren cazar.
 *
 * Aquí se intercepta la carga de cualquier `.css` y se devuelve un objeto
 * vacío, que es lo que un módulo CSS "es" para el código. Así las pruebas
 * pueden iterar `BARBER_WEB_TEMPLATE_IDS` contra el registro REAL.
 *
 * Misma receta que src/lib/barber/__tests__/_sin-server-only.ts: no se toca
 * node_modules (compartido por junction) ni se escribe nada en disco.
 *
 * IMPORTAR ESTE ARCHIVO PRIMERO, antes que ../index: tsx compila a CJS y los
 * imports se ejecutan en orden.
 */
import Module from "node:module";

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  __barberCssStubInstalled?: boolean;
};

if (!M.__barberCssStubInstalled) {
  const original = M._load;
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request.endsWith(".css")) return {};
    return original.call(this, request, parent, isMain);
  };
  M.__barberCssStubInstalled = true;
}

export {};
