import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import {
  hashLivePassword,
  isValidSlug,
} from "@/lib/floor-plan/live-config";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  liveModeEnabled: z.boolean().optional(),
  liveModeSlug: z.string().min(3).max(50).nullable().optional(),
  liveModeShowPatientNames: z.boolean().optional(),
  /** Si null → quita el password. Si string vacío, ignorar. Si string → hash. */
  liveModePassword: z.string().nullable().optional(),
});

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (Supabase + prisma a
// mano), pero pasando por los gates de 2FA y de plan vencido que la copia se
// saltaba. ctx.user es la fila User con permissionsOverride normalizado, así
// que sirve tal cual para denyIfMissingPermission.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

function isMissingTable(err: unknown): boolean {
  // P2021/42P01 = tabla faltante; P2022/42703 = columna faltante (drift de migración)
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "P2022" || e.code === "42P01" || e.code === "42703";
}

/**
 * PATCH /api/clinic-layout/live-config
 * Configura los toggles de la URL pública /live/<slug>: enabled, slug,
 * showPatientNames y password (se hashea bcrypt antes de persistir).
 *
 * Solo admin/owner. Devuelve la clínica con los campos actualizados pero
 * SIN el hash de password.
 */
export async function PATCH(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // EQ-07: "Editar Mi Clínica Visual" del modal (por default SA/ADMIN, los
    // mismos que dejaba pasar la lista de roles que había aquí), con override.
    const denied = denyIfMissingPermission(dbUser, "clinicLayout.edit");
    if (denied) return denied;

    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const data: Prisma.ClinicUpdateInput = {};

    if (parsed.data.liveModeEnabled !== undefined) {
      data.liveModeEnabled = parsed.data.liveModeEnabled;
    }
    if (parsed.data.liveModeShowPatientNames !== undefined) {
      data.liveModeShowPatientNames = parsed.data.liveModeShowPatientNames;
    }
    if (parsed.data.liveModeSlug !== undefined) {
      if (parsed.data.liveModeSlug === null) {
        data.liveModeSlug = null;
      } else {
        const s = parsed.data.liveModeSlug.toLowerCase();
        if (!isValidSlug(s)) {
          return NextResponse.json(
            { error: "invalid_slug", hint: "Solo a-z, 0-9 y guiones (3-50 chars)." },
            { status: 400 },
          );
        }
        // Verificar unicidad (a otra clínica).
        const taken = await prisma.clinic.findFirst({
          where: { liveModeSlug: s, NOT: { id: dbUser.clinicId } },
          select: { id: true },
        });
        if (taken) {
          return NextResponse.json({ error: "slug_taken" }, { status: 409 });
        }
        data.liveModeSlug = s;
      }
    }
    if (parsed.data.liveModePassword !== undefined) {
      if (parsed.data.liveModePassword === null || parsed.data.liveModePassword === "") {
        data.liveModePassword = null;
      } else {
        if (parsed.data.liveModePassword.length < 4) {
          return NextResponse.json(
            { error: "password_too_short", hint: "Mínimo 4 caracteres." },
            { status: 400 },
          );
        }
        data.liveModePassword = await hashLivePassword(parsed.data.liveModePassword);
      }
    }

    const updated = await prisma.clinic.update({
      where: { id: dbUser.clinicId },
      data,
      select: {
        id: true,
        liveModeEnabled: true,
        liveModeSlug: true,
        liveModeShowPatientNames: true,
        // El hash NO se devuelve; solo informamos si está set o no.
      },
    });

    const clinic = await prisma.clinic.findUnique({
      where: { id: dbUser.clinicId },
      select: { liveModePassword: true },
    });

    return NextResponse.json({
      ...updated,
      hasPassword: Boolean(clinic?.liveModePassword),
    });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[PATCH /api/clinic-layout/live-config]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
