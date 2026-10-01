// `server-only` no existe fuera de Next: se vuelve un módulo vacío. Se importa
// PRIMERO en la prueba, para que el parche quede puesto antes de cargar
// cualquier módulo que lo pida.
import Module from "node:module";

const M = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = M._load;
M._load = function (this: unknown, req: string, ...resto: unknown[]) {
  if (req === "server-only" || req === "client-only") return {};
  return cargaOriginal.call(this, req, ...resto);
};
