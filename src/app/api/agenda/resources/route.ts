import { NextResponse } from "next/server";
import { fetchResources } from "@/lib/agenda/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const resources = await fetchResources(session.clinic.id);
  return NextResponse.json({ resources });
}
