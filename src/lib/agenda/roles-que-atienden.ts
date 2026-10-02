// Quién puede ser el DOCTOR de una cita y el tratante de un caso — UNA sola lista (ws1-t12, revisión final).
//
// El formulario de «Abrir caso» proponía al dueño (que atiende) como doctor tratante, pero «Agendar este control»
// validaba con `role: "DOCTOR"` a secas y contestaba «el doctor tratante ya no está activo»: dos listas distintas.
// Ahora las dos leen ESTA: la lista de tratantes (`doctores-tratantes-db.ts`) y la validación del agendado
// (`bot-booking-service.ts`), que usan también el control de retención, los anticipos y el bot.
//
// ws1-t10 (2-oct-2026) — la Agenda del panel seguía con `role: "DOCTOR"` a secas (lista de columnas, Nueva cita,
// POST/PATCH de citas, lista de espera): «Agendar próxima» de ortodoncia daba `doctor_not_found` cuando el tratante
// era el dueño (BEVADENT, 51 de 51 casos). Desde aquí hay UNA regla de «quién puede recibir citas»:
//
//   rol en ROLES_QUE_ATIENDEN  ·  cuenta activa  ·  «Aparece en la agenda» (User.agendaActive) encendida
//
// Recepción y solo lectura nunca entran. Aparecer en la agenda NO da permisos: solo permite ser el doctor de una
// cita; lo que cada quien puede ver o hacer sigue saliendo de su rol y de Equipo → Permisos.
//
// PURO: sin Prisma ni React (lo importan la base, la pantalla y las pruebas).

/** Los mismos roles que la reserva web y el resto del panel cuentan como «quien atiende». */
export const ROLES_QUE_ATIENDEN = ["DOCTOR", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * El filtro de Prisma de «puede recibir citas», para mezclar con `{ id, clinicId }`. El `clinicId` lo pone
 * SIEMPRE quien consulta, de la sesión.
 */
export const RECIBE_CITAS_WHERE = {
  role: { in: [...ROLES_QUE_ATIENDEN] },
  isActive: true,
  agendaActive: true,
};

/** La misma regla, sobre una fila ya cargada. `agendaActive` ausente = encendida (default de la base). */
export function puedeRecibirCitas(u: {
  role: string;
  isActive?: boolean | null;
  agendaActive?: boolean | null;
}): boolean {
  if (u.isActive === false) return false;
  if (u.agendaActive === false) return false;
  return (ROLES_QUE_ATIENDEN as readonly string[]).includes(u.role);
}

/**
 * La frase del `doctor_not_found` de la Agenda (antes salía el código crudo en «Nueva cita»). La devuelve el
 * servidor en `reason` y la usa la pantalla si el cuerpo no la trae.
 */
export const FRASE_NO_RECIBE_CITAS =
  "Ese profesional no puede recibir citas en la Agenda. Elige otro profesional o, si atiende, enciende «Aparece en la agenda» en Equipo.";

/** El cuerpo de la respuesta 404 del servidor: código estable + frase para la persona. */
export function cuerpoDoctorNoRecibeCitas(): { error: "doctor_not_found"; reason: string } {
  return { error: "doctor_not_found", reason: FRASE_NO_RECIBE_CITAS };
}

/**
 * El doctor con el que abre «Nueva cita»: el primer candidato (la columna en la que se hizo clic, el tratante
 * que manda «Agendar próxima»…) que ESTÉ en la lista de quien puede recibir citas; si ninguno, el primero de la
 * lista; si la lista está vacía, "". Así lo que enseña el selector es siempre lo que se envía.
 */
export function doctorQueRecibeCitas(
  candidatos: ReadonlyArray<string | null | undefined>,
  lista: ReadonlyArray<string>,
): string {
  for (const id of candidatos) if (id && lista.includes(id)) return id;
  return lista[0] ?? "";
}
