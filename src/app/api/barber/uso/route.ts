import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBarberContext } from "@/lib/barber-auth";
import { ADMIN_COOKIE, isAdminAuthed } from "@/lib/admin-auth";
import { hayVerComo, validarLote } from "@/lib/barber/uso/uso-core";
import { registrarLote } from "@/lib/barber/uso/registro";

// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/uso — el registrador del panel manda aquí sus lotes
// (cada 30 s con fetch y al salir con sendBeacon). Ver uso-core.ts.
//
//   · La barbería y el usuario salen de la SESIÓN, nunca del cuerpo: una
//     barbería no puede escribir uso a nombre de otra.
//   · No registra nada si en el navegador hay «Ver como barbería» o una
//     sesión válida de admin de DaleControl (el admin no es la barbería).
//   · Sin la tabla → { off: true } y el navegador deja de mandar.
//   · Tope por usuario y minuto (USO_TOPE_SERVIDOR_MIN): lo que sobra se tira.
// Nunca regresa 500 por la analítica: un fallo aquí no le importa a quien trabaja.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

const MAX_BYTES = 32 * 1024;

export async function POST(req: NextRequest) {
  try {
    if (hayVerComo(req.headers.get("cookie"))) {
      return NextResponse.json({ ok: true, omitido: "ver-como" });
    }
    // Barato primero: solo se valida contra la BD si trae la cookie de admin.
    if (req.cookies.get(ADMIN_COOKIE)?.value && (await isAdminAuthed())) {
      return NextResponse.json({ ok: true, omitido: "admin" });
    }

    const texto = await req.text();
    if (texto.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Lote demasiado grande" }, { status: 413 });
    }
    let body: unknown = null;
    try {
      body = JSON.parse(texto);
    } catch {
      body = null;
    }
    const lote = validarLote(body);
    if (!lote) return NextResponse.json({ ok: false, error: "Lote inválido" }, { status: 400 });

    const ctx = await getBarberContext();
    if (!ctx) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

    const r = await registrarLote(
      prisma,
      { barbershopId: ctx.barbershopId, userId: ctx.user.id, sessionId: lote.sid },
      lote.eventos,
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[barber/uso] no se pudo registrar:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false });
  }
}
