import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ clinic: session.clinic });
}
