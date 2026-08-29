import { NextResponse } from "next/server";
import { getEduContext } from "@/lib/edu-auth";

export const dynamic = "force-dynamic";

/**
 * ¿La sesión de Supabase que trae este navegador es de un instituto?
 *
 * Lo consulta el login del vertical justo después de autenticar, para poder
 * decir "esta cuenta no es de aquí" en vez de rebotar en silencio contra
 * /instituto (la cookie de Supabase es una sola para todo el dominio, así
 * que una credencial de clínica autentica perfectamente y no pertenece a
 * ningún instituto).
 *
 * 🔴 Devuelve un booleano y NADA MÁS: ni el nombre del instituto, ni el
 * rol, ni el id. Es un endpoint sin permiso alguno — lo único que puede
 * revelar es lo que quien ya se autenticó sabe de sí mismo.
 */
export async function GET() {
  const ctx = await getEduContext();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true });
}
