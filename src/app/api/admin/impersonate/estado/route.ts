import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth-context";
import { estadoSuplantacionDe } from "@/lib/admin/suplantacion";

export const dynamic = "force-dynamic";

/**
 * ¿La sesión de ESTE navegador es «Ver como clínica»? (ws1-t11, punto 2).
 *
 * La pregunta la hace el vigía de cada pestaña del panel solo cuando la marca
 * df_ver_como cambió desde que se pintó, para confirmar con la verdad del
 * servidor (admin_impersonation_sessions) antes de bloquear la pestaña. No pide
 * sesión de admin: habla solo de la sesión que el propio navegador trae, y a
 * un usuario normal le contesta «no». Pasa por getAuthContext (el gate de 2FA
 * y de sesión terminada) como cualquier ruta del panel.
 */
export async function GET() {
  const sinCache = { headers: { "Cache-Control": "no-store" } };
  if (!(await getAuthContext())) return NextResponse.json({ activa: false }, sinCache);
  const estado = await estadoSuplantacionDe(await createClient());
  if (estado.tipo !== "activa") return NextResponse.json({ activa: false }, sinCache);
  const clinica = await prisma.clinic.findUnique({
    where: { id: estado.fila.clinicId },
    select: { name: true },
  });
  return NextResponse.json(
    { activa: true, id: estado.fila.id, clinica: clinica?.name ?? null, vence: new Date(estado.fila.expiresAt).toISOString() },
    sinCache,
  );
}
