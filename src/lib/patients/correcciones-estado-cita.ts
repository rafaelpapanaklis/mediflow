// ═══════════════════════════════════════════════════════════════════════════
// Estado de una cita que ya cambió pero que la página todavía no re-leyó.
//
// La pestaña Citas del paciente pinta las filas que le manda el servidor
// (`appointments`, prop). Al cancelar, el DELETE responde en un instante pero
// `router.refresh()` vuelve a armar TODA la ficha (segundos): mientras tanto la
// fila seguía diciendo «Agendada». Aquí se apunta lo que el servidor ya
// confirmó y se pinta encima de la fila, sin esperar.
//
// Cada corrección recuerda el estado que TENÍA la fila en el servidor
// (`desde`). En cuanto el servidor manda otra cosa (ya se enteró, o alguien
// la movió de nuevo) la corrección sobra y se descarta: si no, una cita
// cancelada y luego reactivada volvería a pintarse cancelada.
//
// Módulo puro (sin React ni Prisma): lo comparten la ficha, la ventana
// «Editar cita» y la prueba.
// ═══════════════════════════════════════════════════════════════════════════

export interface CitaConEstado {
  id: string;
  status: string;
}

export interface CorreccionDeEstado {
  /** Estado de la fila en el servidor cuando se hizo el cambio. */
  desde: string;
  /** Estado que el servidor confirmó. */
  a: string;
}

export type CorreccionesDeEstado = Record<string, CorreccionDeEstado>;

/**
 * Pinta las correcciones vigentes sobre las filas del servidor. Devuelve la
 * MISMA lista (misma identidad) si ninguna aplica, para no invalidar memos.
 */
export function aplicarCorrecciones<T extends CitaConEstado>(
  citas: T[],
  correcciones: CorreccionesDeEstado,
): T[] {
  if (Object.keys(correcciones).length === 0) return citas;
  let cambio = false;
  const resultado = citas.map((c) => {
    const corr = correcciones[c.id];
    if (!corr || c.status !== corr.desde || c.status === corr.a) return c;
    cambio = true;
    return { ...c, status: corr.a };
  });
  return cambio ? resultado : citas;
}

/**
 * Anota que la cita `id` pasó a `a`. `desde` sale de la fila del SERVIDOR (no
 * de la ya corregida), para que el descarte de `purgarCorrecciones` compare
 * contra lo que de verdad manda el servidor. Si la cita no está en la lista
 * o ya tiene ese estado, no anota nada.
 */
export function registrarCorreccion(
  citasServidor: CitaConEstado[],
  correcciones: CorreccionesDeEstado,
  id: string,
  a: string,
): CorreccionesDeEstado {
  const fila = citasServidor.find((c) => c.id === id);
  if (!fila || fila.status === a) return correcciones;
  return { ...correcciones, [id]: { desde: fila.status, a } };
}

/**
 * Quita las correcciones que el servidor ya alcanzó o superó: la fila ya no
 * está, o su estado dejó de ser el `desde`. Devuelve el MISMO objeto si no
 * hay nada que quitar (un `setState` con él no re-renderiza).
 */
export function purgarCorrecciones(
  citasServidor: CitaConEstado[],
  correcciones: CorreccionesDeEstado,
): CorreccionesDeEstado {
  const ids = Object.keys(correcciones);
  if (ids.length === 0) return correcciones;
  const porId = new Map(citasServidor.map((c) => [c.id, c.status]));
  let cambio = false;
  const vivas: CorreccionesDeEstado = {};
  for (const id of ids) {
    const estadoServidor = porId.get(id);
    if (estadoServidor !== undefined && estadoServidor === correcciones[id].desde) {
      vivas[id] = correcciones[id];
    } else {
      cambio = true;
    }
  }
  return cambio ? vivas : correcciones;
}
