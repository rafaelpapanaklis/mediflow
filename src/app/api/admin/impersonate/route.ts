import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const adminToken = cookies().get("admin_token")?.value;
  if (!adminToken || adminToken !== process.env.ADMIN_SECRET_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clinicId = req.nextUrl.searchParams.get("clinicId");
  if (!clinicId) return NextResponse.json({ error: "clinicId required" }, { status: 400 });

  const user = await prisma.user.findFirst({
    where: { clinicId, role: "SUPER_ADMIN" },
    select: { supabaseId: true, email: true, firstName: true, lastName: true },
  });
  if (!user) return NextResponse.json({ error: "Clinic owner not found" }, { status: 404 });

  // Return info for admin to see - can't actually impersonate without Supabase service role key
  const html = `
    <!DOCTYPE html><html><head><title>Vista de clínica</title>
    <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}</style></head>
    <body><div style="text-align:center;max-width:400px">
      <div style="font-size:48px;margin-bottom:16px">🏥</div>
      <h2 style="color:#38bdf8">Información de la clínica</h2>
      <p style="color:#94a3b8">Para ver el panel del doctor, necesitas su contraseña.</p>
      <div style="background:#1e293b;border-radius:12px;padding:16px;margin:16px 0;text-align:left">
        <div style="margin-bottom:8px"><span style="color:#64748b">Email:</span> <strong>${user.email}</strong></div>
        <div><span style="color:#64748b">Nombre:</span> <strong>${user.firstName} ${user.lastName}</strong></div>
      </div>
      <p style="color:#64748b;font-size:12px">Nota: La impersonación completa requiere la Service Role Key de Supabase. Configúrala como variable de entorno SUPABASE_SERVICE_ROLE_KEY para activarla.</p>
      <a href="/admin/clinics/${clinicId}" style="color:#3b82f6">← Volver al perfil de la clínica</a>
    </div></body></html>
  `;
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}
