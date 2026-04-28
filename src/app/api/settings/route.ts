import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Whitelist of allowed fields to update
  const allowed = [
    "name", "phone", "email", "address", "city", "description", "logoUrl",
    "taxId", "rfcEmisor", "regimenFiscal", "cpEmisor",
    "waReminderActive", "waReminder24h", "waReminder1h", "waReminderMsg",
    "recallActive", "recallMonths",
    "isPublic",
    // Inbox integrations (Fase 6)
    "twilioAccountSid", "twilioAuthToken", "twilioWhatsappNumber",
    "postmarkInboundEmail",
  ];

  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const clinic = await prisma.clinic.update({
    where: { id: ctx.clinicId },
    data,
  });

  return NextResponse.json(clinic);
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
  });

  return NextResponse.json(clinic);
}
