export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamClient } from "./team-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { horarioClinica } from "@/components/dashboard/horario-doctor/tipos";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { getCupoUsuarios } from "@/lib/team/cupo-usuarios";
import { getOpcionesSubida } from "@/lib/team/opciones-subida";
import { isClinicBillingAdmin } from "@/lib/billing/authz";

export const metadata: Metadata = { title: "Equipo — DaleControl" };

export default async function TeamPage() {
  const user = await getCurrentUser();
  // Reemplaza el gate ADMIN/SUPER_ADMIN por el permiso UI granular.
  // El boton "Permisos" del modal queda gated por isSuperAdmin en el
  // cliente, así un ADMIN puede ver/editar el equipo pero no asignar
  // permisos granulares.
  requirePermissionOrRedirect(user, "team.view");

  // REDISEÑO DE EQUIPO — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles y el rediseño de Pacientes (`clinic_feature_flags`,
  // bandera `menu-dos-niveles`), no uno propio. Falla cerrado (sin tabla,
  // sin fila o con error → false = la pantalla de hoy, tal cual). Va en el
  // mismo Promise.all que la lista de equipo para no añadir un viaje sin
  // superponer; la respuesta además vive 60 s en memoria por clínica.
  //
  // + el horario de la CLÍNICA (ws1-t3, horario por doctor): la ventana
  // «Horario» de cada doctor dice «sigue el horario de la clínica (Lun-Vie
  // 9:00-19:00…)» y avisa de las horas que se salen de él. Tercera consulta
  // del mismo Promise.all, con el clinicId de la sesión.
  // ws1-t3: la pregunta «¿solo dental o también ortodoncista?» solo se hace si la
  // sede es dental y tiene el módulo contratado de verdad (sin el atajo de trial).
  const [team, rediseno, horarios, ortoModulo, cupo, subida] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId: user.clinicId },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        role: true, specialty: true, color: true, avatarUrl: true,
        phone: true, isActive: true, createdAt: true, services: true,
        // NOM-024 — SIN estos tres el modal «Editar» arrancaba con la cédula y la
        // especialidad oficial vacías y el PATCH las guardaba como null: guardar
        // cualquier otro dato (el teléfono) BORRABA la cédula del médico.
        cedulaProfesional: true, especialidad: true, cedulaEspecialidad: true,
        // «Atiende pacientes» (la casilla del modal y el botón «Horario» del dueño).
        agendaActive: true,
        // Override granular del set default del role — visible solo en el
        // modal de Permisos del SUPER_ADMIN.
        permissionsOverride: true,
        _count: {
          select: {
            appointments: { where: { status: { not: "CANCELLED" } } },
            records: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
    }),
    menuDosNivelesEncendido(user.clinicId),
    prisma.clinicSchedule.findMany({
      where: { clinicId: user.clinicId },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      orderBy: { dayOfWeek: "asc" },
    }),
    user.clinic.category === "DENTAL" ? hasActiveOrthodonticsModule(user.clinicId).catch(() => false) : Promise.resolve(false),
    // El MISMO conteo que usa el servidor al crear/reactivar (getCupoUsuarios): la
    // pantalla avisa antes de llenar el formulario, no al guardar.
    getCupoUsuarios(user.clinicId),
    getOpcionesSubida(user.clinicId),
  ]);

  return (
    <TeamClient
      key={user.clinicId}
      team={team as any}
      currentUserId={user.id}
      currentUserRole={user.role}
      clinicName={user.clinic.name}
      rediseno={rediseno}
      horarioClinica={horarioClinica(horarios)}
      sedeDental={user.clinic.category === "DENTAL"}
      ortoModulo={ortoModulo}
      cupo={cupo}
      subida={{ ...subida, puedeSubir: isClinicBillingAdmin(user.role) }}
    />
  );
}
