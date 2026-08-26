/**
 * `server-only` NO existe en node_modules (Next lo resuelve en webpack), así
 * que `npx tsx --test` sobre un módulo que lo importe muere con
 * "Cannot find module 'server-only'". tsx compila los .ts como CJS y ejecuta
 * los imports en orden: basta importar ESTE archivo PRIMERO en el test para
 * que el require de `server-only` devuelva {} (lo mismo que hace Next en
 * react-server). Sin flags, sin hooks, sin tocar node_modules.
 */
import Module from "node:module";

const STUBBED = new Set(["server-only", "client-only"]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  __sinServerOnly?: boolean;
};

if (!M.__sinServerOnly) {
  const original = M._load;
  M._load = function (this: unknown, req: string, parent: unknown, isMain: boolean) {
    if (STUBBED.has(req)) return {};
    return original.call(this, req, parent, isMain);
  };
  M.__sinServerOnly = true;
}

export {};
