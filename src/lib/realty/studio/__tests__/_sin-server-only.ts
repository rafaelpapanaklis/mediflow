// `server-only` no existe en node_modules (Next lo alias-ea en webpack), así
// que tsx muere al importar cualquier módulo del servidor. Se parchea
// Module._load con lo mismo que devuelve Next bajo react-server: un objeto
// vacío. Tiene que ser el PRIMER import del test.
import Module from "node:module";

const STUBBED = new Set(["server-only", "client-only"]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  __stubInstalled?: boolean;
};

if (!M.__stubInstalled) {
  const original = M._load;
  M._load = function (req: string, parent: unknown, isMain: boolean) {
    if (STUBBED.has(req)) return {};
    return original.call(this, req, parent, isMain);
  };
  M.__stubInstalled = true;
}

export {};
