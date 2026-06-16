import { NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { drainScheduledPosts } from "@/lib/marketing/publish-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/marketing/run-scheduler
// Dispara el drenado de la cola a mano (útil en QA, sin esperar al cron */5).
// Solo admin, y acotado a SU PROPIA clínica: jamás toca posts de otras clínicas
// (aislamiento multi-tenant). Reusa exactamente la misma lógica idempotente del
// cron (drainScheduledPosts).
export async function POST() {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const result = await drainScheduledPosts({ clinicId: ctx!.clinicId });
  return NextResponse.json(result);
}
