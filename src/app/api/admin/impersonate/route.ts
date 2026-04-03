import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  // 1. Verify admin is authenticated
  const adminToken = cookies().get("admin_token")?.value;
  if (!adminToken || adminToken !== process.env.ADMIN_SECRET_TOKEN) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // 2. Get clinicId from query
  const clinicId = req.nextUrl.searchParams.get("clinicId");
  if (!clinicId) {
    return NextResponse.json({ error: "clinicId requerido" }, { status: 400 });
  }

  // 3. Check Service Role Key is configured
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

  // 4. Get clinic owner email
  const user = await prisma.user.findFirst({
    where: { clinicId, role: "SUPER_ADMIN" },
    select: { supabaseId: true, email: true, firstName: true, lastName: true },
  });

  if (!user) {
    return NextResponse.json({ error: "No se encontró el dueño de la clínica" }, { status: 404 });
  }

  // 5. Create admin Supabase client with service role
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // 6. Generate magic link for the user
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: `${req.nextUrl.origin}/dashboard` },
  });

  if (error || !data?.properties?.hashed_token) {
    console.error("Error generating magic link:", error);
    return NextResponse.json({ error: "Error al generar acceso temporal" }, { status: 500 });
  }

  // 7. Build the magic link URL and redirect
  const magicLinkUrl = new URL(`${req.nextUrl.origin}/api/auth/callback`);
  magicLinkUrl.searchParams.set("token_hash", data.properties.hashed_token);
  magicLinkUrl.searchParams.set("type", "email");
  magicLinkUrl.searchParams.set("next", "/dashboard");

  // Add a banner param so the dashboard knows we're in admin mode
  const finalUrl = `${req.nextUrl.origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=email&next=/dashboard`;

  return NextResponse.redirect(finalUrl);
}
