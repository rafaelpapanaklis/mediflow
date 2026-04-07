import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const file = await prisma.patientFile.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!file) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Delete from Supabase Storage
  try {
    const supabase = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const urlPath = new URL(file.url).pathname;
    const storagePath = urlPath.split("/patient-files/").pop();
    if (storagePath) {
      await supabase.storage.from("patient-files").remove([storagePath]);
    }
  } catch (e) {
    console.error("Storage delete error (non-fatal):", e);
  }

  await prisma.patientFile.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
