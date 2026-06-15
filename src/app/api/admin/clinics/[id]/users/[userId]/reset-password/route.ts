import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logAudit, extractAuditMeta } from "@/lib/audit";

// Service-role client. Mismo patrón que /api/team/[id]/reset-password/route.ts —
// usa SUPABASE_SERVICE_ROLE_KEY (NUNCA exponer al cliente). Se deshabilita
// session/refresh porque el client es solo para llamar al Admin API.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// POST /api/admin/clinics/[id]/users/[userId]/reset-password
//
// El admin GLOBAL (cookie admin_token) asigna MANUALMENTE una contraseña nueva
// a cualquier usuario de la clínica — la escribe él mismo y viaja en el body por
// HTTPS. La contraseña vive en Supabase Auth, así que se cambia con el Admin API
// (service role), no en Prisma. NUNCA se loguea en claro.
//
// A diferencia de /api/team/[id]/reset-password (solo SUPER_ADMIN de la clínica,
// que NO puede tocar a otro SUPER_ADMIN), el admin global SÍ puede cambiar la de
// cualquier rol — incluido SUPER_ADMIN — y de usuarios inactivos.
//
// Multi-tenant: exigimos que el target pertenezca a params.id, para que una URL
// manipulada no cambie contraseñas de usuarios de otra clínica.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Env guard: sin service role no podemos tocar Supabase Auth. Error claro,
  // no rompe el resto del panel.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service role no está configurado en el servidor" },
      { status: 500 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres" },
      { status: 400 },
    );
  }
  // Supabase Auth (bcrypt) trunca/rechaza > 72 chars — cortamos con error claro.
  if (password.length > 72) {
    return NextResponse.json(
      { error: "La contraseña no puede exceder 72 caracteres" },
      { status: 400 },
    );
  }

  // Multi-tenant: el target debe existir Y pertenecer a esta clínica.
  const target = await prisma.user.findFirst({
    where:  { id: params.userId, clinicId: params.id },
    select: { id: true, supabaseId: true, email: true, firstName: true, lastName: true },
  });
  if (!target) {
    return NextResponse.json(
      { error: "Usuario no encontrado en esta clínica" },
      { status: 404 },
    );
  }
  if (!target.supabaseId) {
    return NextResponse.json(
      { error: "El usuario no tiene cuenta de autenticación — no se puede cambiar la contraseña" },
      { status: 400 },
    );
  }

  const supabaseAdmin = getAdminClient();
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    target.supabaseId,
    { password },
  );

  if (updateError) {
    console.error(
      "[admin/clinics/[id]/users/[userId]/reset-password] supabase update failed:",
      updateError,
    );
    return NextResponse.json(
      { error: "No se pudo actualizar la contraseña en Supabase" },
      { status: 500 },
    );
  }

  // Audit log — registramos la ACCIÓN y el target, JAMÁS la contraseña.
  // AuditLog.userId es FK NOT NULL a User y el admin global (cookie) no tiene
  // fila User; usamos el propio target (válido y de esta clínica) como ancla y
  // `by: "admin"` deja constancia de que fue una acción del admin, no del user.
  const meta = extractAuditMeta(req);
  await logAudit({
    clinicId:   params.id,
    userId:     target.id,
    entityType: "user",
    entityId:   target.id,
    action:     "update",
    changes: {
      passwordReset: { before: false, after: true },
      by:            { before: null, after: "admin" },
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  // Atribución de admin a Vercel Logs (logAudit no captura "qué admin" porque el
  // admin global se autentica por cookie, no por User). NUNCA incluye contraseña.
  console.log(JSON.stringify({
    type:      "admin.user.passwordReset",
    at:        new Date().toISOString(),
    clinicId:  params.id,
    userId:    target.id,
    userEmail: target.email,
    ip:        meta.ipAddress ?? null,
  }));

  return NextResponse.json({ success: true });
}
