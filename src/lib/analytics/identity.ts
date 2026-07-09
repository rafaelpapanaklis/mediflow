// Resolución de identidad del visitante a partir de las cookies (servidor).
// Objetivo del owner: saber SI una clínica/usuario registrado visita (landing o panel).
// Prioridad: staff (identifica clínica) > paciente (portal) > admin (owner) > anónimo.
//
// Coste: la rama staff hace un getUser() a Supabase Auth (red). Por eso el caller
// (/api/track) sólo invoca resolveIdentity() al CREAR la sesión o mientras siga
// anónima — nunca en cada evento.

import { cookies } from "next/headers";
import { createHash } from "crypto";
import { prismaAdmin } from "@/lib/prisma-admin";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_CLINIC_COOKIE, unpackClinicCookie } from "@/lib/active-clinic-core";

const ADMIN_COOKIE = "admin_token";
const PATIENT_SESSION_COOKIE = "patient_session";

export interface ResolvedIdentity {
  identityType: "anonymous" | "staff" | "patient" | "admin";
  clinicId: string | null;
  userId: string | null;
  patientAccountId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  plan: string | null;
}

const ANON: ResolvedIdentity = {
  identityType: "anonymous",
  clinicId: null,
  userId: null,
  patientAccountId: null,
  email: null,
  displayName: null,
  role: null,
  plan: null,
};

export async function resolveIdentity(): Promise<ResolvedIdentity> {
  let jar: ReturnType<typeof cookies>;
  try {
    jar = cookies();
  } catch {
    return { ...ANON };
  }

  // 1) STAFF — la señal más valiosa (clínica identificada).
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const sUser = data?.user;
    if (sUser) {
      const clinicId = unpackClinicCookie(jar.get(ACTIVE_CLINIC_COOKIE)?.value);
      const user = await prismaAdmin.user.findFirst({
        where: { supabaseId: sUser.id, isActive: true, ...(clinicId ? { clinicId } : {}) },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          clinicId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          clinic: { select: { name: true, plan: true } },
        },
      });
      if (user) {
        const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
        return {
          identityType: "staff",
          clinicId: user.clinicId,
          userId: user.id,
          patientAccountId: null,
          email: user.email ?? sUser.email ?? null,
          displayName: name || user.clinic?.name || null,
          role: user.role ?? null,
          plan: (user.clinic?.plan as string | undefined) ?? null,
        };
      }
      // Usuario Supabase sin fila User (proveedor/lab/afiliado global): staff sin clínica.
      return { ...ANON, identityType: "staff", email: sUser.email ?? null };
    }
  } catch {
    /* best-effort */
  }

  // 2) PACIENTE — portal.
  try {
    const token = jar.get(PATIENT_SESSION_COOKIE)?.value;
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const session = await prismaAdmin.patientAccountSession.findUnique({
        where: { tokenHash },
        select: {
          expiresAt: true,
          account: {
            select: {
              id: true,
              name: true,
              email: true,
              links: { select: { clinicId: true }, take: 1 },
            },
          },
        },
      });
      if (session && session.expiresAt.getTime() > Date.now() && session.account) {
        const clinicId = session.account.links?.[0]?.clinicId ?? null;
        let plan: string | null = null;
        let clinicName: string | null = null;
        if (clinicId) {
          const c = await prismaAdmin.clinic.findUnique({
            where: { id: clinicId },
            select: { name: true, plan: true },
          });
          plan = (c?.plan as string | undefined) ?? null;
          clinicName = c?.name ?? null;
        }
        return {
          identityType: "patient",
          clinicId,
          userId: null,
          patientAccountId: session.account.id,
          email: session.account.email ?? null,
          displayName: session.account.name || clinicName,
          role: null,
          plan,
        };
      }
    }
  } catch {
    /* ignore */
  }

  // 3) ADMIN de plataforma (owner) — sólo si trae admin_token y nada más.
  try {
    if (jar.get(ADMIN_COOKIE)?.value) {
      return { ...ANON, identityType: "admin" };
    }
  } catch {
    /* ignore */
  }

  return { ...ANON };
}
