// Quién puede ser el DOCTOR de una cita y el tratante de un caso — UNA sola lista (ws1-t12, revisión final).
//
// El formulario de «Abrir caso» proponía al dueño (que atiende) como doctor tratante, pero «Agendar este control»
// validaba con `role: "DOCTOR"` a secas y contestaba «el doctor tratante ya no está activo»: dos listas distintas.
// Ahora las dos leen ESTA: la lista de tratantes (`doctores-tratantes-db.ts`) y la validación del agendado
// (`bot-booking-service.ts`), que usan también el control de retención, los anticipos y el bot.
//
// PURO: sin Prisma ni React (lo importan la base y las pruebas).

/** Los mismos roles que la reserva web y el resto del panel cuentan como «quien atiende». */
export const ROLES_QUE_ATIENDEN = ["DOCTOR", "ADMIN", "SUPER_ADMIN"] as const;
