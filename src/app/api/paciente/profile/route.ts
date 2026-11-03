// GET + PATCH /api/paciente/profile — Implementa A9.
// GET → 200 PacientePerfil { id, name, email, phone, createdAt, clinics } | 401.
//   clinics igual que summary (links → patient → clinic).
// PATCH body UpdateProfileBody { name?, phone?, currentPassword?, newPassword? }:
//   · getPatientPortalContext() | 401. rateLimit(req, 10).
//   · name: trim, 2-120 chars. phone: trim, dígitos/espacios/+-(), 10-20 chars.
//   · Cambio de contraseña: SOLO si vienen ambos (currentPassword + newPassword
//     ≥8). verifyPassword(currentPassword) o 400. Tras cambiarla se cierran
//     TODAS las sesiones y esta pestaña sigue dentro con una nueva (Set-Cookie).
//   · El email NO se puede cambiar (es la identidad de vinculación).
//   → 200 { ok: true }.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { createPatientSession, destroyAllSessions, sessionCookieOptions } from "@/lib/patient-portal/session";
import { PATIENT_SESSION_COOKIE } from "@/lib/patient-portal/types";
import { hashPassword, verifyPassword } from "@/lib/patient-portal/crypto";
import type { PacienteClinica, PacientePerfil, UpdateProfileBody } from "@/lib/patient-portal/types";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const account = await prisma.patientAccount.findUnique({
      where: { id: ctx.account.id },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });
    if (!account) return pacienteUnauthorized();

    const links = await prisma.patientAccountLink.findMany({
      // Seguridad (auditoría «cloudflare», nº7): solo los expedientes que el guard dejó
      // pasar (ctx.links: siguen con el email de esta cuenta). Mismo criterio que el
      // guard, sin repetirlo en SQL (revisión t12, m3).
      where: { accountId: account.id, patientId: { in: ctx.links.map((l) => l.patientId) }, patient: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        clinicId: true,
        patient: {
          select: {
            id: true,
            patientNumber: true,
            clinic: {
              select: { id: true, name: true, slug: true, logoUrl: true, city: true, phone: true },
            },
          },
        },
      },
    });

    const clinics: PacienteClinica[] = links.map((link) => ({
      clinicId: link.clinicId,
      clinicName: link.patient.clinic.name,
      clinicSlug: link.patient.clinic.slug,
      logoUrl: link.patient.clinic.logoUrl,
      city: link.patient.clinic.city,
      phone: link.patient.clinic.phone,
      patientId: link.patient.id,
      patientNumber: link.patient.patientNumber,
    }));

    const perfil: PacientePerfil = {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.phone,
      createdAt: account.createdAt.toISOString(),
      clinics,
    };

    return NextResponse.json(perfil);
  } catch (err) {
    console.error("[paciente/profile] GET error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const limited = rateLimit(req, 10);
    if (limited) return limited;

    let body: UpdateProfileBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
    }

    const data: { name?: string; phone?: string; passwordHash?: string } = {};

    // Nombre: si viene, trim 2-120.
    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
      }
      const name = body.name.trim();
      if (name.length < 2 || name.length > 120) {
        return NextResponse.json(
          { error: "El nombre debe tener entre 2 y 120 caracteres" },
          { status: 400 }
        );
      }
      data.name = name;
    }

    // Teléfono: si viene, al limpiar no-dígitos quedan 10-20; se guardan solo dígitos.
    if (body.phone !== undefined) {
      if (typeof body.phone !== "string") {
        return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });
      }
      const digits = body.phone.trim().replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 20) {
        return NextResponse.json(
          { error: "El teléfono debe tener entre 10 y 20 dígitos" },
          { status: 400 }
        );
      }
      data.phone = digits;
    }

    // Cambio de contraseña: SOLO si vienen ambos campos. Cierra TODAS las demás
    // sesiones de la cuenta y deja abierta solo esta (con una sesión nueva).
    const wantsPasswordChange =
      body.currentPassword !== undefined || body.newPassword !== undefined;
    if (wantsPasswordChange) {
      if (
        typeof body.currentPassword !== "string" ||
        body.currentPassword.length === 0 ||
        typeof body.newPassword !== "string" ||
        body.newPassword.length === 0
      ) {
        return NextResponse.json(
          { error: "Para cambiar la contraseña envía la contraseña actual y la nueva" },
          { status: 400 }
        );
      }
      if (body.newPassword.length < 8) {
        return NextResponse.json(
          { error: "La nueva contraseña debe tener al menos 8 caracteres" },
          { status: 400 }
        );
      }

      const account = await prisma.patientAccount.findUnique({
        where: { id: ctx.account.id },
        select: { passwordHash: true },
      });
      if (!account) return pacienteUnauthorized();

      const valid = await verifyPassword(body.currentPassword, account.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "La contraseña actual no es correcta" },
          { status: 400 }
        );
      }

      data.passwordHash = await hashPassword(body.newPassword);
    }

    // El email NO se toca: es la identidad de vinculación de la cuenta.
    if (Object.keys(data).length > 0) {
      await prisma.patientAccount.update({ where: { id: ctx.account.id }, data });

      // ws1-t12 — el propio paciente cambió sus datos del portal: queda en los
      // movimientos de CADA ficha a la que su cuenta está ligada (sin valores).
      const cambios: string[] = [];
      if (data.name !== undefined) cambios.push("su nombre");
      if (data.phone !== undefined) cambios.push("su teléfono");
      if (data.passwordHash !== undefined) cambios.push("su contraseña del portal");
      const campos = [
        ...(data.name !== undefined ? ["name"] : []),
        ...(data.phone !== undefined ? ["phone"] : []),
      ];
      const texto = `Cambió ${cambios.length > 1 ? `${cambios.slice(0, -1).join(", ")} y ${cambios[cambios.length - 1]}` : cambios[0]} desde su portal`;
      for (const l of ctx.links) {
        await registrarMovimientoExterno({
          actor: "patient",
          clinicId: l.clinicId,
          patientId: l.patientId,
          entityType: "patient",
          entityId: l.patientId,
          action: "update",
          texto,
          campos,
          req,
        });
      }
    }

    // Seguridad (auditoría ola 3, «pre-secuestro»): cambiar la contraseña cierra
    // TODAS las sesiones de la cuenta. Antes las demás seguían vivas 30 días, así
    // que quien hubiera entrado con la contraseña vieja no salía. Esta pestaña
    // sigue dentro con una sesión nueva.
    if (data.passwordHash !== undefined) {
      await destroyAllSessions(ctx.account.id);
      const { token, expiresAt } = await createPatientSession(ctx.account.id);
      const res = NextResponse.json({ ok: true });
      res.cookies.set(PATIENT_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return res;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[paciente/profile] PATCH error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
