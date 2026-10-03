export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { especialidadParaElSelector } from "@/lib/team/especialidad-equipo";
import { rolLlevaDatosClinicos } from "@/lib/team/parche-miembro";
import { MiPerfilClient } from "./mi-perfil-client";

export const metadata: Metadata = { title: "Mi perfil — DaleControl" };

// «Mi perfil» (ws1-t1): cada persona edita SUS datos personales y profesionales — también un DOCTOR, que no
// tiene `settings.view` ni `team.edit` y antes no podía corregir su propia cédula. Sin permiso propio: es la
// fila de la sesión y nada más (PATCH /api/users/me). Rol, permisos y correo se ven, no se editan.
export default async function MiPerfilPage() {
  const user = await getCurrentUser();
  const fila = await prisma.user.findFirst({
    where: { id: user.id, clinicId: user.clinicId },
    select: {
      firstName: true, lastName: true, email: true, phone: true, role: true, specialty: true,
      cedulaProfesional: true, especialidad: true, cedulaEspecialidad: true,
    },
  });
  if (!fila) return null;
  return (
    <MiPerfilClient
      inicial={{
        firstName: fila.firstName ?? "",
        lastName: fila.lastName ?? "",
        phone: fila.phone ?? "",
        // Como en Equipo: «dental» se lee como «Odontología General»; lo desconocido, tal cual.
        specialty: especialidadParaElSelector(fila.specialty),
        cedulaProfesional: fila.cedulaProfesional ?? "",
        especialidad: fila.especialidad ?? "",
        cedulaEspecialidad: fila.cedulaEspecialidad ?? "",
      }}
      email={fila.email}
      role={fila.role}
      clinico={rolLlevaDatosClinicos(fila.role)}
    />
  );
}
