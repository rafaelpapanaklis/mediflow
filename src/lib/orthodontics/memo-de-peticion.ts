// ─────────────────────────────────────────────────────────────────────────────
// Memoria de UNA petición (tercera auditoría, N-31).
//
// La precarga de la pestaña Ortodoncia corre ~11 lecturas dentro de UNA acción de servidor, y cada una repetía su
// autenticación: sesión (Supabase + usuario + clínica), módulo activo, el caso y su paciente (visibilidad). Medido en
// panel.108: cada consulta de Prisma por el pooler son ~4 idas (BEGIN, DEALLOCATE, consulta, COMMIT) de ~180 ms.
//
// Dentro de `conMemoDePeticion` (solo la precarga lo abre), esas lecturas se hacen UNA vez y se comparten; fuera de
// él `memoDePeticion` llama a la función como siempre. Nada sale de la petición: la memoria muere con ella, y la
// sesión, los permisos y la clínica son los mismos para todas las lecturas de esa petición.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";

const almacen = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function conMemoDePeticion<T>(f: () => Promise<T>): Promise<T> {
  return almacen.run(new Map(), f);
}

export function memoDePeticion<T>(clave: string, f: () => Promise<T>): Promise<T> {
  const m = almacen.getStore();
  if (!m) return f();
  const previo = m.get(clave);
  if (previo) return previo as Promise<T>;
  const p = f();
  m.set(clave, p);
  // Un fallo no se queda guardado: la siguiente lectura lo reintenta.
  p.catch(() => m.delete(clave));
  return p;
}
