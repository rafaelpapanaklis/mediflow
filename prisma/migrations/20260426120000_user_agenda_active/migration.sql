-- M5: Per-doctor agenda visibility flag.
-- Doctores existentes (Users con role=DOCTOR) ya están en /dashboard/team;
-- en lugar de un modelo DoctorAgendaSettings nuevo extendemos User con un
-- flag para controlar si el doctor aparece como columna en la agenda.
-- El color de agenda reutiliza User.color (ya existente con default #3b82f6).

ALTER TABLE "users"
  ADD COLUMN "agendaActive" BOOLEAN NOT NULL DEFAULT true;
