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
 * Con qué «Aparece en la agenda» NACE una cuenta (decisiones de Rafael, 2-oct-2026). El dueño que registra una
 * clínica nueva y el doctor que se da de alta en Equipo, marcados; un administrador nuevo, desmarcado (lleva la
 * clínica, no necesariamente atiende: si atiende, se marca en Equipo → Editar). Recepción y solo lectura quedan
 * con el default de la base: la casilla no les da nada mientras su rol no atienda. Lo de las clínicas YA creadas
 * no se decide aquí: es `sql/ws1-t10-dueno-fuera-de-agenda.sql`.
 */
export function agendaActiveAlCrear(role: string): boolean {
  return role !== "ADMIN";
}

/**
 * La casilla del dueño en una SEDE nueva: la COPIA de la suya en su sede principal (decisión de Rafael,
 * 2-oct-2026; una sede no es una clínica nueva). `principal` = su fila SUPER_ADMIN activa en la clínica más
 * antigua del mismo supabaseId; si no se encontrara, la de un dueño nuevo (marcado).
 */
export function agendaActiveDeSedeNueva(principal: { agendaActive?: boolean | null } | null | undefined): boolean {
  if (!principal) return agendaActiveAlCrear("SUPER_ADMIN");
  return principal.agendaActive !== false;
}

/**
 * La frase GENÉRICA del `doctor_not_found` de la Agenda: la usa la pantalla solo si el servidor no mandó
 * `reason` (el servidor manda la del motivo concreto, `fraseNoRecibeCitas`).
 */
export const FRASE_NO_RECIBE_CITAS =
  "Ese profesional no puede recibir citas en la Agenda: su cuenta está inactiva, tiene apagada «Aparece en la agenda» o su rol no atiende pacientes. Elige otro profesional.";

/**
 * Por qué alguien NO puede recibir citas (revisión de ws1-t10: la frase hablaba de «Aparece en la agenda»
 * también a una cuenta inactiva o a recepción). El orden es el del arreglo: un rol que no atiende no se arregla
 * con la casilla, y una cuenta inactiva no se arregla encendiéndola.
 */
export type MotivoNoRecibeCitas = "no_encontrado" | "rol" | "inactivo" | "agenda_apagada";

/** El motivo, o `null` si sí puede recibir citas. `null`/`undefined` = no existe en la clínica. */
export function motivoNoRecibeCitas(
  u: { role: string; isActive?: boolean | null; agendaActive?: boolean | null } | null | undefined,
): MotivoNoRecibeCitas | null {
  if (!u) return "no_encontrado";
  if (!(ROLES_QUE_ATIENDEN as readonly string[]).includes(u.role)) return "rol";
  if (u.isActive === false) return "inactivo";
  if (u.agendaActive === false) return "agenda_apagada";
  return null;
}

const ETIQUETA_ROL: Record<string, string> = { RECEPTIONIST: "Recepción", READONLY: "Solo lectura" };

/**
 * La frase de cada motivo. `tratante`: el doctor lo pone el caso de ortodoncia (no se elige en la ventana), así
 * que el arreglo es cambiar el tratante del caso, no «elegir otro».
 */
export function fraseNoRecibeCitas(
  motivo: MotivoNoRecibeCitas,
  opts: { role?: string | null; tratante?: boolean } = {},
): string {
  const quien = opts.tratante ? "El doctor tratante de este caso" : "Ese profesional";
  const otro = opts.tratante ? "Cambia el doctor tratante del caso" : "Elige otro profesional";
  switch (motivo) {
    case "inactivo":
      return `${quien} no puede recibir citas: su cuenta está inactiva. ${otro} o reactiva su cuenta en Equipo.`;
    case "agenda_apagada":
      return `${quien} no puede recibir citas: tiene apagada «Aparece en la agenda». ${otro} o, si atiende, enciende esa casilla en su cuenta de Equipo.`;
    case "rol": {
      const rol = (opts.role && ETIQUETA_ROL[opts.role]) || null;
      const quienRol = opts.tratante ? "El doctor tratante de este caso" : "Esa persona";
      return `${quienRol} no puede recibir citas: ${rol ? `su rol (${rol})` : "su rol"} no atiende pacientes. ${otro}: un doctor, un administrador o el dueño.`;
    }
    case "no_encontrado":
      return opts.tratante
        ? `El doctor tratante de este caso ya no está en la clínica. ${otro}.`
        : "Ese profesional ya no está en la clínica. Recarga la página y elige otro.";
  }
}

/**
 * El cuerpo de la respuesta 404 del servidor: código estable + frase del motivo concreto. `fila` = el usuario
 * leído SOLO por `{ id, clinicId }` (sin la regla); sin fila = no existe en esta clínica.
 */
export function cuerpoDoctorNoRecibeCitas(
  fila?: { role: string; isActive?: boolean | null; agendaActive?: boolean | null } | null,
): { error: "doctor_not_found"; reason: string; motivo: MotivoNoRecibeCitas } {
  // Si la fila SÍ cumple la regla (carrera: alguien la encendió entre las dos lecturas), la genérica.
  const motivo = motivoNoRecibeCitas(fila);
  return {
    error: "doctor_not_found",
    reason: motivo ? fraseNoRecibeCitas(motivo, { role: fila?.role }) : FRASE_NO_RECIBE_CITAS,
    motivo: motivo ?? "no_encontrado",
  };
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
