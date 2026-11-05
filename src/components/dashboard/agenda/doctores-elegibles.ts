/**
 * ws1-t11 · P2 v3 — a quién se le puede dar una cita desde la pantalla. Puro: se prueba solo.
 *
 *  · `doctoresQueRecibenCitas`: «¿Quién lo atiende?» solo ofrece a quien puede recibir citas (la regla de
 *    `RECIBE_CITAS_WHERE`, sobre filas ya cargadas: `puedeRecibirCitas`). La lista vieja «Citas» carga a todos
 *    los usuarios activos (recepción, solo lectura…): sin el filtro, elegir a la recepcionista daba 404.
 *  · `opcionesDeDoctorAlEditar`: en «Editar cita», un DOCTOR con una «Sin doctor» solo puede TOMARLA (P1:
 *    `doctorPuedeEditar`): ni otros doctores ni «Sin doctor» en el selector, y abre consigo mismo. Así guardar
 *    no da 403 `not_your_appointment`. Para los demás (y para un DOCTOR con su propia cita) nada cambia aquí.
 */
import { puedeRecibirCitas } from "@/lib/agenda/roles-que-atienden";

export function doctoresQueRecibenCitas<T extends { id: string; role: string; isActive?: boolean | null; agendaActive?: boolean | null }>(
  lista: readonly T[],
  nombre: (d: T) => string,
): { id: string; nombre: string }[] {
  return lista.filter((d) => puedeRecibirCitas(d)).map((d) => ({ id: d.id, nombre: nombre(d) }));
}

export function opcionesDeDoctorAlEditar<T extends { id: string }>(args: {
  rol: string | null | undefined;
  userId: string | null | undefined;
  citaDoctorId: string | null | undefined;
  doctores: readonly T[];
  ofreceSinDoctor: boolean;
}): { doctores: T[]; sinDoctor: boolean; inicial: string | null } {
  if (args.rol === "DOCTOR" && !args.citaDoctorId) {
    const yo = args.doctores.filter((d) => !!args.userId && d.id === args.userId);
    return { doctores: yo, sinDoctor: false, inicial: yo[0]?.id ?? null };
  }
  return { doctores: [...args.doctores], sinDoctor: args.ofreceSinDoctor, inicial: null };
}
