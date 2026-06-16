// ═══════════════════════════════════════════════════════════════════
// API de plantillas de Marketing (WS-MKT-T6).
//   GET  → plantillas globales (clinicId=null) + las de la clínica.
//          Filtros opcionales ?kind= y ?specialty=.
//   POST → guarda una plantilla de la CLÍNICA (la usa el botón
//          "Guardar como plantilla" del Estudio IA, WS-MKT-T2).
//
// Multi-tenant: el clinicId SIEMPRE sale de getAuthContext(), nunca del
// body. Una plantilla creada por una clínica jamás se crea como global.
// ═══════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const KINDS = ["IDEA", "CAPTION", "CAMPAIGN", "IMAGE_BRIEF"] as const;

const CreateSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  specialty: z.string().trim().min(1).max(40).optional(),
});

export async function GET(req: Request) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const kindParam = searchParams.get("kind");
    const specialtyParam = searchParams.get("specialty");

    // Globales (clinicId null) + las propias de la clínica.
    const where: any = { OR: [{ clinicId: null }, { clinicId: ctx.clinicId }] };

    if (kindParam && (KINDS as readonly string[]).includes(kindParam)) {
      where.kind = kindParam;
    }
    if (specialtyParam) {
      // Incluye universales (specialty null) + las de esa especialidad.
      where.AND = [{ OR: [{ specialty: specialtyParam }, { specialty: null }] }];
    }

    const templates = await prisma.marketingTemplate.findMany({
      where,
      orderBy: [{ clinicId: "asc" }, { createdAt: "desc" }],
      take: 500,
    });

    return NextResponse.json({ templates });
  } catch (e) {
    console.error("[marketing/templates GET]", e);
    // Degrada a lista vacía: la biblioteca igual muestra el set integrado.
    return NextResponse.json({ error: "Error al cargar plantillas", templates: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const json = await req.json().catch(() => null);
    const parsed = CreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { kind, title, body, tags, specialty } = parsed.data;

    const template = await prisma.marketingTemplate.create({
      data: {
        clinicId: ctx.clinicId, // SIEMPRE del contexto — nunca global desde cliente
        kind,
        title,
        body,
        tags: tags ?? [],
        specialty: specialty ?? null,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (e) {
    console.error("[marketing/templates POST]", e);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}
