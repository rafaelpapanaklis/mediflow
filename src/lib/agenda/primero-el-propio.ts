// La columna del propio doctor, primero (ws1-t1, ronda de arreglos de la auditoría de uso — C-91 y C-96).
//
// Un DOCTOR solo recibe SUS citas (`doctorIdScope`), pero la agenda le pinta las columnas de todo el equipo, en
// el orden del padrón. En la clínica de prueba, con 22 profesionales, la columna de «T9final S.» quedaba fuera de
// la pantalla, a la derecha de 21 columnas vacías: el doctor veía «0 citas» en todas y creía que su cita de las
// 23:01 no estaba. Con su columna primero la ve sin desplazarse. A los demás roles no se les cambia el orden.

export function primeroElPropio<T extends { id: string }>(doctores: T[], userId: string | null | undefined, role: string | null | undefined): T[] {
  if (role !== "DOCTOR" || !userId) return doctores;
  const i = doctores.findIndex((d) => d.id === userId);
  if (i <= 0) return doctores;
  return [doctores[i], ...doctores.slice(0, i), ...doctores.slice(i + 1)];
}
