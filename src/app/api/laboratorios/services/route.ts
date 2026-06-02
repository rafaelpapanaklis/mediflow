import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDentalLabContext } from "@/lib/lab-auth";
import { DENTAL_LAB_SERVICES, type DentalLabServiceDTO } from "@/lib/laboratorios/types";

// Lee cookies de sesión (getDentalLabContext) → siempre dinámico, nunca cacheado.
export const dynamic = "force-dynamic";

// serviceKey válidos = las 9 llaves fijas del catálogo (s1–s9).
const VALID_SERVICE_KEYS = new Set(DENTAL_LAB_SERVICES.map((s) => s.key as string));

// Serializa un DentalLabService al DTO de red del contrato compartido
// (@/lib/laboratorios/types). Helper local — sin serializers.ts compartido.
function serializeService(s: any): DentalLabServiceDTO {
  return {
    id: s.id,
    labId: s.labId,
    serviceKey: s.serviceKey,
    name: s.name,
    description: s.description ?? null,
    priceFrom: s.priceFrom,
    unit: s.unit,
    daysMin: s.daysMin ?? null,
    daysMax: s.daysMax ?? null,
    imageUrl: s.imageUrl ?? null,
    isActive: s.isActive,
  };
}

// Normaliza un valor de "días" opcional: undefined/null/"" → null; entero ≥ 0 → n;
// cualquier otra cosa → { ok:false } para devolver 400.
function normDays(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = Math.floor(Number(v));
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// ── GET /api/laboratorios/services ───────────────────────────────────────
// Catálogo de servicios del laboratorio en sesión. labId SIEMPRE de la sesión.
export async function GET() {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de laboratorio no está aprobada." }, { status: 403 });
  }

  const services = await prisma.dentalLabService.findMany({
    where: { labId: ctx.labId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(services.map(serializeService));
}

// ── POST /api/laboratorios/services ──────────────────────────────────────
// Crea un servicio para el laboratorio en sesión.
export async function POST(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de laboratorio no está aprobada." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const serviceKey = typeof body?.serviceKey === "string" ? body.serviceKey.trim() : "";
  if (!VALID_SERVICE_KEYS.has(serviceKey)) {
    return NextResponse.json({ error: "El tipo de servicio no es válido." }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "El nombre del servicio es requerido." }, { status: 400 });
  }

  const priceNum = typeof body?.priceFrom === "number" ? body.priceFrom : Number(body?.priceFrom);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return NextResponse.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
  }

  const dMin = normDays(body?.daysMin);
  const dMax = normDays(body?.daysMax);
  if (!dMin.ok || !dMax.ok) {
    return NextResponse.json({ error: "Los días de entrega deben ser enteros mayores o iguales a 0." }, { status: 400 });
  }
  if (dMin.value !== null && dMax.value !== null && dMin.value > dMax.value) {
    return NextResponse.json({ error: "El mínimo de días no puede ser mayor que el máximo." }, { status: 400 });
  }

  const description =
    typeof body?.description === "string" && body.description.trim() ? body.description.trim() : null;
  const unit =
    typeof body?.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 30) : "pieza";
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;

  const service = await prisma.dentalLabService.create({
    data: {
      labId: ctx.labId, // SIEMPRE de la sesión, nunca del body.
      serviceKey,
      name: name.slice(0, 200),
      description,
      priceFrom: Math.round(priceNum * 100) / 100,
      unit,
      daysMin: dMin.value,
      daysMax: dMax.value,
      isActive,
    },
  });

  return NextResponse.json(serializeService(service), { status: 201 });
}
