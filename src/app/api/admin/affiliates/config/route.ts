import { isAdminAuthed } from "@/lib/admin-auth";
// Config global del programa de afiliados (niveles bronce/plata/oro).
// GET → { config: ProgramConfig, exists: boolean } (exists=false ⇒ tabla sin
//   crear: el front muestra "corre sql/afiliados-ventas.sql" y modo legacy).
// PUT { bronzePct, silverPct, goldPct, silverMinActive, goldMinActive } →
//   upsert fila id=1.
// Auth: cookie admin_token === ADMIN_SECRET_TOKEN (mismo patrón que
// /api/admin/coupons).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PROGRAM_CONFIG } from "@/lib/affiliate-levels";


// Normaliza la fila de BD al shape ProgramConfig (sin id/updatedAt).
function toConfig(row: {
  bronzePct: number;
  silverPct: number;
  goldPct: number;
  silverMinActive: number;
  goldMinActive: number;
}) {
  return {
    bronzePct: row.bronzePct,
    silverPct: row.silverPct,
    goldPct: row.goldPct,
    silverMinActive: row.silverMinActive,
    goldMinActive: row.goldMinActive,
  };
}

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const row = await prisma.affiliateProgramConfig.findUnique({ where: { id: 1 } });
    // Tabla viva: con fila → config real; sin fila → defaults (exists true).
    return NextResponse.json({ config: row ? toConfig(row) : DEFAULT_PROGRAM_CONFIG, exists: true });
  } catch {
    // Tabla inexistente (sql/afiliados-ventas.sql sin correr) → modo legacy. Nunca 500.
    return NextResponse.json({ config: DEFAULT_PROGRAM_CONFIG, exists: false });
  }
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const bronzePct = Number(body?.bronzePct);
  const silverPct = Number(body?.silverPct);
  const goldPct = Number(body?.goldPct);
  const silverMinActive = Number(body?.silverMinActive);
  const goldMinActive = Number(body?.goldMinActive);

  for (const pct of [bronzePct, silverPct, goldPct]) {
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) {
      return NextResponse.json(
        { error: "Cada porcentaje debe ser un número mayor a 0 y máximo 50" },
        { status: 400 }
      );
    }
  }
  for (const min of [silverMinActive, goldMinActive]) {
    if (!Number.isInteger(min) || min < 1 || min > 1000) {
      return NextResponse.json(
        { error: "Los umbrales de clínicas activas deben ser enteros entre 1 y 1000" },
        { status: 400 }
      );
    }
  }
  if (goldMinActive <= silverMinActive) {
    return NextResponse.json(
      { error: "Las clínicas activas para Oro deben ser más que las requeridas para Plata" },
      { status: 400 }
    );
  }
  if (!(goldPct >= silverPct && silverPct >= bronzePct)) {
    return NextResponse.json(
      { error: "Los porcentajes deben cumplir Oro ≥ Plata ≥ Bronce" },
      { status: 400 }
    );
  }

  const data = { bronzePct, silverPct, goldPct, silverMinActive, goldMinActive };
  try {
    const row = await prisma.affiliateProgramConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true, config: toConfig(row) });
  } catch {
    // Tabla inexistente: el admin ve el aviso y sabe qué correr.
    return NextResponse.json({ error: "Corre sql/afiliados-ventas.sql en Supabase" }, { status: 503 });
  }
}
