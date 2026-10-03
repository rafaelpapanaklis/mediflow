// «Se creó un paciente» — el aviso que el «Nuevo paciente» GENERAL (barra superior, paleta, atajo N, Hoy…)
// deja en la ventana para que la lista de Pacientes se recargue (ws1-t1, auditoría BEVADENT, E1).
//
// EL FALLO: el proveedor global llamaba a `router.refresh()`, que rehace lo que pinta el servidor; pero la lista
// de Pacientes pide sus filas desde el navegador (`/api/patients`), así que el paciente recién creado no salía
// hasta recargar la página a mano. La copia del modal que monta la propia lista sí recargaba; el botón general no.

export const EVENTO_PACIENTE_CREADO = "dalecontrol:paciente-creado";

export interface DetallePacienteCreado {
  id: string;
}

/** Lo dispara quien crea el paciente. Sin `window` (servidor) no hace nada. */
export function avisarPacienteCreado(detalle: DetallePacienteCreado): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DetallePacienteCreado>(EVENTO_PACIENTE_CREADO, { detail: detalle }));
}

/** Escucha el aviso. Devuelve la función que deja de escuchar (para el `return` de un `useEffect`). */
export function alCrearsePaciente(fn: (detalle: DetallePacienteCreado) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const oyente = (e: Event) => fn((e as CustomEvent<DetallePacienteCreado>).detail ?? { id: "" });
  window.addEventListener(EVENTO_PACIENTE_CREADO, oyente);
  return () => window.removeEventListener(EVENTO_PACIENTE_CREADO, oyente);
}
