import { origenPublicoDe } from "@/lib/url-publica";
import { NextRequest, NextResponse } from "next/server";
import { clienteAdminSupabase } from "@/lib/admin/supabase-admin";
import { prisma } from "@/lib/prisma";
import { writeActiveClinicCookie } from "@/lib/active-clinic";
import { getAdminSession } from "@/lib/admin-auth";
import { setVerComoCookie } from "@/lib/auth/two-factor-cookie";
import { createClient as crearClienteDeSesion } from "@/lib/supabase/server";
import {
  DURACION_SUPLANTACION_MS,
  NOTA_MIN,
  SQL_SUPLANTACION,
  limpiarNota,
  sessionIdDelToken,
} from "@/lib/admin/suplantacion-core";
import { registrarSuplantacion, tablaDeSuplantacionLista } from "@/lib/admin/suplantacion";

/**
 * «Ver como clínica» (auditoría 30-sep-2026, M5).
 *
 * Antes: un GET que generaba un magic link del dueño y abría una sesión normal
 * de Supabase (30 días renovables), con la nota de auditoría «si se puede».
 * Ahora:
 *   · solo POST (el middleware exige Origin de esta web en /api/admin);
 *   · la NOTA del admin es obligatoria y se guarda ANTES de abrir nada — si no
 *     se pudo escribir, no se entra;
 *   · la sesión de Supabase se crea aquí, en el servidor, y se registra por su
 *     session_id en admin_impersonation_sessions con vencimiento de 2 h
 *     (@/lib/admin/suplantacion): al vencer, el panel la trata como sin sesión;
 *   · sin la tabla (SQL sin pegar) contesta 503 y no abre sesión.
 * La bitácora de la clínica (audit_logs / Movimientos) queda como estaba:
 * pausa de Rafael del 1-oct, pendiente de que decida cómo se muestra.
 */

function pagina(titulo: string, texto: string, clinicId: string | null, status: number): NextResponse {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const volver = clinicId ? `<a href="/admin/clinics/${encodeURIComponent(clinicId)}" style="color:#3b82f6;text-decoration:none">← Volver al perfil de la clínica</a>` : "";
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}</style></head>
<body><div style="text-align:center;max-width:480px;padding:24px"><h2 style="color:#f59e0b">${esc(titulo)}</h2><p style="color:#94a3b8">${esc(texto)}</p>${volver}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** GET ya no abre sesión (era un GET con efectos, fuera del chequeo de Origin). */
export async function GET(req: NextRequest) {
  return pagina(
    "Usa el botón «Ver como clínica»",
    "Entrar como una clínica ahora se hace desde su ficha en /admin, escribiendo el motivo.",
    req.nextUrl.searchParams.get("clinicId"),
    405,
  );
}

async function leerCampos(req: NextRequest): Promise<{ clinicId: string | null; nota: unknown }> {
  const tipo = req.headers.get("content-type") ?? "";
  try {
    if (tipo.includes("application/json")) {
      const b = (await req.json()) as { clinicId?: unknown; nota?: unknown };
      return { clinicId: typeof b.clinicId === "string" ? b.clinicId : null, nota: b.nota };
    }
    const f = await req.formData();
    const c = f.get("clinicId");
    return { clinicId: typeof c === "string" ? c : null, nota: f.get("nota") };
  } catch {
    return { clinicId: null, nota: null };
  }
}

export async function POST(req: NextRequest) {
  // 1. Admin de plataforma con sesión real en BD.
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // 2. Clínica y nota (obligatoria).
  const campos = await leerCampos(req);
  const clinicId = campos.clinicId?.trim() || null;
  if (!clinicId) {
    return pagina("Falta la clínica", "No llegó el id de la clínica.", null, 400);
  }
  const nota = limpiarNota(campos.nota);
  if (!nota) {
    return pagina("Escribe el motivo", `Para entrar como la clínica hay que escribir el motivo (mínimo ${NOTA_MIN} caracteres).`, clinicId, 400);
  }

  // 3. Service Role Key configurada
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return new NextResponse(`
      <!DOCTYPE html>
      <html>
      <head><title>Configuración requerida</title>
      <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}</style>
      </head>
      <body>
        <div style="text-align:center;max-width:480px;padding:24px">
          <div style="font-size:48px;margin-bottom:16px">⚙️</div>
          <h2 style="color:#f59e0b">Falta variable de entorno</h2>
          <p style="color:#94a3b8">Para usar "Ver como clínica" necesitas agregar la Service Role Key de Supabase en Vercel.</p>
          <div style="background:#1e293b;border-radius:12px;padding:16px;margin:16px 0;text-align:left;font-size:13px">
            <div style="color:#64748b;margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Pasos:</div>
            <ol style="color:#cbd5e1;margin:0;padding-left:16px;line-height:1.8">
              <li>Ve a <a href="https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/settings/api" style="color:#38bdf8">Supabase → Settings → API</a></li>
              <li>Copia la clave <strong style="color:#f59e0b">service_role</strong></li>
              <li>Ve a <a href="https://vercel.com/rafaelpapanaklis-9168s-projects/mediflow/settings/environment-variables" style="color:#38bdf8">Vercel → Environment Variables</a></li>
              <li>Agrega: <code style="background:#0f172a;padding:2px 6px;border-radius:4px;color:#34d399">SUPABASE_SERVICE_ROLE_KEY</code></li>
              <li>Redespliega el proyecto</li>
            </ol>
          </div>
          <a href="/admin/clinics/${clinicId}" style="color:#3b82f6;text-decoration:none">← Volver al perfil de la clínica</a>
        </div>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // 4. Sin registro no se entra: la tabla tiene que existir ANTES de abrir nada.
  if (!(await tablaDeSuplantacionLista())) {
    return pagina(
      "Falta un paso en la base",
      `«Ver como clínica» necesita la tabla de suplantaciones. Pega ${SQL_SUPLANTACION} en Supabase y vuelve a intentarlo.`,
      clinicId,
      503,
    );
  }

  // 5. Dueño de la clínica
  const user = await prisma.user.findFirst({
    where: { clinicId, role: "SUPER_ADMIN" },
    select: { id: true, supabaseId: true, email: true, firstName: true, lastName: true },
  });

  if (!user) {
    return NextResponse.json({ error: "No se encontró el dueño de la clínica" }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;

  // 6. La nota del admin, ANTES de abrir la sesión. Mismo registro de siempre
  // (AdminClinicNote, que se ve en /admin), ahora con el motivo; si no se pudo
  // escribir, no se entra.
  try {
    await prisma.adminClinicNote.create({
      data: {
        clinicId,
        authorId: null,
        content: `[IMPERSONATION] admin ${admin.user.email} accedió como ${user.email} (${user.firstName} ${user.lastName}) desde IP ${ip ?? "unknown"} · UA ${ua ?? "unknown"} · ${new Date().toISOString()} · motivo: ${nota}`,
      },
    });
  } catch (logErr) {
    console.error("[impersonate] audit log failed:", logErr);
    return pagina("No se pudo registrar la entrada", "La nota de auditoría no se guardó, así que no se abre la sesión. Inténtalo de nuevo.", clinicId, 503);
  }

  // 7. Enlace de un solo uso del dueño, canjeado AQUÍ (no en el navegador del admin):
  // la sesión nace en el servidor y conocemos su session_id para registrarla.
  const supabaseAdmin = clienteAdminSupabase(serviceRoleKey);
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: `${origenPublicoDe(req, req.url)}/dashboard` },
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("Error generating magic link:", error);
    return NextResponse.json({ error: "Error al generar acceso temporal" }, { status: 500 });
  }

  const supabase = crearClienteDeSesion();
  try { await supabase.auth.signOut(); } catch { /* sin sesión previa en este navegador */ }
  const canje = await supabase.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  const sessionId = sessionIdDelToken(canje.data?.session?.access_token);
  if (canje.error || !sessionId) {
    console.error("[impersonate] verifyOtp falló:", canje.error?.message);
    try { await supabase.auth.signOut(); } catch { /* nada que cerrar */ }
    return NextResponse.json({ error: "Error al abrir la sesión temporal" }, { status: 500 });
  }

  // 8. Registro de la sesión. Si no queda escrito, se cierra lo abierto y no se entra.
  const expiresAt = new Date(Date.now() + DURACION_SUPLANTACION_MS);
  try {
    await registrarSuplantacion({
      adminUserId: admin.user.id,
      adminEmail: admin.user.email,
      clinicId,
      targetUserId: user.id,
      targetSupabaseId: user.supabaseId,
      supabaseSessionId: sessionId,
      nota,
      ip,
      userAgent: ua,
      expiresAt,
    });
  } catch (e) {
    console.error("[impersonate] registro de la sesión falló:", e);
    try { await supabase.auth.signOut(); } catch { /* best effort */ }
    return pagina("No se pudo registrar la sesión", "No se abre la sesión sin su registro. Inténtalo de nuevo.", clinicId, 503);
  }
  console.warn("[impersonate]", JSON.stringify({ clinicId, admin: admin.user.email, targetUser: user.email, ip, expiresAt: expiresAt.toISOString() }));

  // 303: el navegador sigue con GET a /dashboard. Las cookies de Supabase las
  // escribió el cliente SSR de arriba en esta misma respuesta.
  const response = NextResponse.redirect(`${origenPublicoDe(req, req.url)}/dashboard`, 303);
  // Setear la cookie activeClinicId firmada para la clínica impersonada.
  // Sin esto, getAuthContext cae al fallback (primer User por createdAt asc)
  // cuando el super-admin pertenece a múltiples clínicas.
  writeActiveClinicCookie(response, clinicId);
  // ws1-t8: «Ver como clínica» no puede quedar atrapado en el 2FA del dueño:
  // ni en su reto, si lo activó por su cuenta (pediría el celular del dueño),
  // ni en el enrolamiento si su clínica exige 2FA a todo el equipo. Quien llega
  // aquí ya pasó la sesión de admin de
  // plataforma —con su propio TOTP—, así que se le da la prueba firmada
  // df_2fa_admin para ESTA persona y ESTA clínica (12 h). Un login normal la
  // borra (applyTwoFactorLoginCookies) y cerrar sesión también.
  setVerComoCookie(response, user.supabaseId, clinicId);
  return response;
}
