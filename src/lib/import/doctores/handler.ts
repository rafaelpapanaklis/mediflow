// DOCTORES/PROFESIONALES migrados (ws1-t12, importador Dentalink, sep-2026):
// 10_Usuarios_Profesionales trae los profesionales del sistema anterior. Cada
// fila crea o EMPAREJA un usuario DOCTOR real (con cuenta de Supabase Auth,
// como cualquier alta de equipo) para que las citas y los bloqueos importados
// tengan un doctorId de verdad — pero SIN mandar invitación ni correo:
//   · Igual que el alta de equipo (src/app/api/team/route.ts): contraseña
//     temporal generada por el sistema, `email_confirm: true` para saltar la
//     verificación, y NUNCA se manda el correo con la contraseña. Con
//     mustChangePassword=true, el doctor queda "pendiente de activar": existe,
//     puede recibir citas y bloqueos, pero no puede entrar al panel hasta que
//     alguien le dé sus credenciales o pida un reset.
//   · EMPAREJAR, no duplicar: si el correo (o, si no hay correo, la cédula)
//     ya es de un usuario de esta clínica, no se crea cuenta nueva — solo se
//     completan los campos que le falten (cédula, especialidad, teléfono).
//     Nunca se adivina un correo que no viene en el archivo: sin correo NI
//     cédula, la fila es un error y se empareja a mano.
//   · Un profesional "deshabilitado" en el origen entra con isActive=false:
//     no cuenta para el cupo de usuarios del plan ni aparece en las listas de
//     equipo activo, pero sí puede ser doctorId de una cita/bloqueo histórico.
//
// Construido en un archivo NUEVO (no en entities.ts), mismo criterio que
// pagos-historial: el registro final (entities.ts/detect-entity.ts/client.ts)
// lo hace ws1-t12 una vez que el handler está listo.
//
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa).

import { prisma } from "@/lib/prisma";
import { CLINIC_OVERRIDE_SELECT } from "@/lib/billing/plan-overrides";
import { traducirErrorDeAuth } from "@/lib/auth/errores-contrasena";
import type { PreviewRow } from "../types";
import { BATCH, norm, normName, type EntityHandler, type MappedRow, type ImportContext } from "../engine";
import { cellText, oneLine } from "../migrado";
import { ESPECIALIDAD_ORTODONCIA, overrideConAcceso } from "@/lib/orthodontics/acceso-doctor";
import { getAdminClient } from "./supabase-admin";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const DOCTOR_COLORS = [
  "#3b82f6", "#7c3aed", "#059669", "#e11d48", "#d97706",
  "#0891b2", "#db2777", "#4338ca", "#16a34a", "#dc2626",
  "#9333ea", "#0284c7", "#f97316", "#84cc16",
];

function tempPassword(): string {
  return `Medi${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.floor(10 + Math.random() * 90)}!`;
}

/** ¿La columna de "habilitado" dice explícitamente que NO? Vacía o afirmativa = sí (por omisión). */
function parseActivo(v: unknown): boolean {
  const n = norm(cellText(v));
  if (!n) return true;
  return !/^(no|0|false|inactivo|deshabilitado|baja|desactivado|n)$/.test(n);
}

const pickInsertable = (rows: PreviewRow[]) => rows.filter((r) => r.status === "ok");

export const doctorsHandler: EntityHandler = {
  entity: "doctors",
  auditEntityType: "user",
  sheetNames: ["usuariosprofesionales", "profesionales", "dentistas", "doctores", "usuarios"],
  headerVariants: {
    name: ["nombre", "nombres", "nombrecompleto"],
    lastName: ["apellido", "apellidos", "lastname"],
    email: ["email", "correo", "correoelectronico", "mail"],
    phone: ["celular", "telefono", "movil", "whatsapp", "phone"],
    // Cédula profesional (México) / rut (vocabulario chileno de Dentalink): el
    // mismo campo, dos nombres probables. Ver la cita de fuente en profiles/dentalink.ts.
    license: ["cedula", "cedulaprofesional", "numerocedula", "rut", "licenciaprofesional", "nrocedula"],
    specialty: ["especialidad", "idespecialidad", "especialidaddental"],
    active: ["habilitado", "activo", "estatus", "estado", "enabled"],
  },

  validateMapping(campos) {
    if (!campos.has("name") && !campos.has("lastName")) return "Falta el nombre del doctor";
    if (!campos.has("email") && !campos.has("license")) {
      return "Falta una columna de correo o cédula profesional para identificar al doctor";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const existentes = await prisma.user.findMany({
      where: { clinicId },
      select: { id: true, email: true, cedulaProfesional: true, especialidad: true, phone: true, firstName: true, lastName: true, isActive: true },
    });
    const byEmail = new Map(existentes.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
    const byLicense = new Map(existentes.filter((u) => u.cedulaProfesional).map((u) => [norm(u.cedulaProfesional!), u]));

    const clinicPlan = await prisma.clinic.findUnique({ where: { id: clinicId }, select: CLINIC_OVERRIDE_SELECT });
    // Import dinámico a propósito: @/lib/plans lleva `import "server-only"`, y un
    // import estático lo cargaría con solo importar este handler (p. ej. desde
    // entities.ts para el registro/detección), tumbando cualquier test que ni
    // siquiera llegue a llamar process()/commit() de doctores. Diferido a
    // runtime, solo se toca cuando de verdad se importa un archivo de doctores.
    const { getPlanLimitsForClinic } = await import("@/lib/plans");
    const { maxUsers } = await getPlanLimitsForClinic(clinicPlan);
    const activosHoy = existentes.filter((u) => u.isActive).length;
    let cupoRestante = maxUsers == null ? Infinity : Math.max(0, maxUsers - activosHoy);

    const out: PreviewRow[] = [];
    const vistosEnArchivo = new Set<string>();

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const firstName = oneLine(mapped.name, 100);
      const lastName = oneLine(mapped.lastName, 100);
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
      if (!fullName) pr.errors.push("Falta el nombre del doctor");

      const emailRaw = cellText(mapped.email).toLowerCase();
      if (emailRaw && !EMAIL_RE.test(emailRaw)) pr.errors.push(`Correo "${emailRaw}" inválido`);
      const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : "";
      const license = oneLine(mapped.license, 15);
      const phone = mapped.phone ? oneLine(mapped.phone, 30) : "";
      const specialty = mapped.specialty ? oneLine(mapped.specialty, 100) : "";
      const active = parseActivo(mapped.active);

      if (!email && !license) {
        pr.errors.push("Falta correo o cédula profesional: no se puede crear ni emparejar sin uno de los dos");
      }
      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      // Emparejar: primero por correo, luego por cédula.
      const matched = (email && byEmail.get(email)) || (license && byLicense.get(norm(license))) || null;

      const key = email || `lic:${norm(license)}`;
      if (vistosEnArchivo.has(key)) {
        pr.status = "duplicate";
        pr.warnings.push("Doctor repetido en el archivo");
        out.push(pr);
        continue;
      }
      vistosEnArchivo.add(key);

      if (matched) {
        pr.warnings.push(`Ya existe como «${matched.firstName} ${matched.lastName}»: se completan los datos que falten, sin crear cuenta nueva`);
        Object.assign(pr.data, {
          matchedExistingId: matched.id,
          license: license || matched.cedulaProfesional || null,
          specialty: specialty || matched.especialidad || null,
          phone: phone || matched.phone || null,
          name: fullName,
        });
      } else {
        if (!email) {
          pr.errors.push("No hay una cuenta existente con esa cédula, y sin correo no se puede crear una nueva: agrega el correo del doctor o empareja a mano");
          pr.status = "error";
          out.push(pr);
          continue;
        }
        if (active) {
          if (cupoRestante <= 0) {
            pr.errors.push("Límite de usuarios del plan alcanzado: sube de plan o marca a este doctor como deshabilitado en el archivo");
            pr.status = "error";
            out.push(pr);
            continue;
          }
          cupoRestante--;
        }
        Object.assign(pr.data, {
          matchedExistingId: null,
          firstName, lastName, name: fullName, email, license: license || null, specialty: specialty || null, phone: phone || null, active,
        });
      }
      out.push(pr);
    }
    return out;
  },

  async commit(rows: PreviewRow[], clinicId: string, _skipDuplicates: boolean, ctx: ImportContext) {
    const toProcess = pickInsertable(rows);
    if (toProcess.length === 0) return { created: 0, skipped: 0 };

    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { name: true, category: true } });
    const admin = getAdminClient();
    let created = 0;
    // I9: como el alta de Equipo, un doctor cuya especialidad es Ortodoncia recibe el acceso al módulo (si la clínica
    // lo tiene activo). Import dinámico: access.ts lleva `import "server-only"` (ver arriba).
    let moduloOrtodoncia = false;
    if (clinic?.category === "DENTAL") {
      try {
        const { hasActiveOrthodonticsModule } = await import("@/lib/orthodontics/access");
        moduloOrtodoncia = await hasActiveOrthodonticsModule(clinicId);
      } catch { moduloOrtodoncia = false; }
    }
    const esOrtodoncia = (t: unknown) => typeof t === "string" && norm(t).includes("ortodonc");

    for (let i = 0; i < toProcess.length; i += BATCH) {
      for (const r of toProcess.slice(i, i + BATCH)) {
        try {
          if (r.data.matchedExistingId) {
            const cambios: Record<string, string> = {};
            if (r.data.license) cambios.cedulaProfesional = r.data.license as string;
            if (r.data.specialty) cambios.especialidad = r.data.specialty as string;
            if (r.data.phone) cambios.phone = r.data.phone as string;
            if (Object.keys(cambios).length > 0) {
              await prisma.user.updateMany({ where: { id: r.data.matchedExistingId as string }, data: cambios });
            }
            created++;
            continue;
          }

          const { data: sbUser, error: createError } = await admin.auth.admin.createUser({
            email: r.data.email as string,
            password: tempPassword(),
            email_confirm: true,
            user_metadata: { firstName: r.data.firstName, lastName: r.data.lastName, clinicName: clinic?.name ?? "" },
          });
          if (createError || !sbUser?.user) {
            const msg = createError?.message ?? "";
            r.status = "error";
            r.errors.push(
              msg.includes("already been registered") || msg.includes("already exists")
                ? "Este correo ya tiene cuenta en DaleControl (de otra clínica): empareja a mano"
                : traducirErrorDeAuth(createError, "No se pudo crear la cuenta del doctor"),
            );
            continue;
          }

          const usados = await prisma.user.findMany({ where: { clinicId }, select: { color: true } });
          const color = DOCTOR_COLORS.find((c) => !usados.some((u) => u.color === c)) ?? DOCTOR_COLORS[0];

          // La especialidad del archivo llena TAMBIÉN el selector de especialidad de la ficha (`specialty`), no solo
          // el campo oficial NOM-024 (`especialidad`). Ortodoncia + módulo activo → acceso al módulo.
          const conAccesoOrto = esOrtodoncia(r.data.specialty) && moduloOrtodoncia;
          const permisosOrto = conAccesoOrto ? overrideConAcceso({ role: "DOCTOR", permissionsOverride: [] }, "ortodoncista") : null;
          await prisma.user.create({
            data: {
              supabaseId: sbUser.user.id,
              clinicId,
              email: r.data.email as string,
              firstName: r.data.firstName as string,
              lastName: r.data.lastName as string,
              role: "DOCTOR",
              color,
              phone: (r.data.phone as string | null) ?? null,
              isActive: r.data.active as boolean,
              agendaActive: r.data.active as boolean,
              cedulaProfesional: (r.data.license as string | null) ?? null,
              especialidad: (r.data.specialty as string | null) ?? null,
              specialty: conAccesoOrto ? ESPECIALIDAD_ORTODONCIA : ((r.data.specialty as string | null) ?? null),
              ...(permisosOrto && permisosOrto.length > 0 ? { permissionsOverride: permisosOrto } : {}),
              mustChangePassword: true,
            },
          });
          created++;
        } catch (e: any) {
          r.status = "error";
          r.errors.push(e?.code === "P2002" ? "Ya existe un doctor con ese correo en esta clínica" : "No se pudo guardar la fila (error de base de datos)");
        }
      }
    }

    const erroredNow = toProcess.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toProcess.length - created - erroredNow) };
  },
};
