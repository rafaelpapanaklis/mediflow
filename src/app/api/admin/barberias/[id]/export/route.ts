import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { getAdminSession } from "@/lib/admin-auth";
import { exportarBarberia } from "@/lib/barber/admin-export";

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/barberias/[id]/export — ZIP con CSV de clientes, citas,
// tickets y sus líneas + manifest.json de una barbería (y sus sucursales,
// si es matriz). El «Exportar» de la ficha de clínica del dental
// (/api/admin/clinics/[id]/export), con el mismo guard de sesión de admin.
//
// Bitácora: el exportar del dental no deja ninguna (ni audit_logs ni otra
// tabla), así que aquí tampoco se crea una; queda una línea en el log del
// servidor con QUIÉN exportó QUÉ barbería y cuántas filas (sin datos).
// ═══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const exp = await exportarBarberia(params.id);
    if (!exp) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });
    console.info(
      `[admin/barberias/export] ${session.user.email} exportó ${params.id} (${exp.manifest.sedes.length} sedes):`,
      JSON.stringify(exp.manifest.counts),
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    const pass = new PassThrough();
    archive.pipe(pass);
    archive.append(JSON.stringify(exp.manifest, null, 2), { name: "manifest.json" });
    for (const a of exp.archivos) archive.append(a.contenido, { name: a.nombre });
    archive.finalize();

    // Como el del dental: se junta en memoria (suficiente para una barbería).
    const chunks: Buffer[] = [];
    for await (const chunk of pass) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    const fname = `dalecontrol-barberia-${exp.slug}-${new Date().toISOString().slice(0, 10)}.zip`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/admin/barberias/[id]/export error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
