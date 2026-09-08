import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { EduPadronError } from "@/lib/edu/padron";
import { aceptarEduQuotePorToken, getEduQuotePorToken } from "@/lib/edu/presupuestos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * API PÚBLICA DEL PRESUPUESTO — SIN SESIÓN. EL TOKEN ES LA CREDENCIAL.
 *
 * La abre el PACIENTE en su teléfono, desde una liga que le mandaron. Aquí
 * NO hay getEduContext, no hay permiso y no hay institutionId de sesión:
 * todo lo que protege este endpoint es lo que comprueba él mismo. Es el
 * mismo diseño —y el mismo archivo de al lado— que la carta pública de
 * consentimiento.
 *
 * Vive bajo `publico/` porque Next.js no admite dos segmentos dinámicos
 * con nombres distintos al mismo nivel (`[id]` y `[token]` serían un error
 * de build) y la ruta del panel ya usa `[id]`.
 *
 * 🔴 UN TOKEN CON MALA FORMA Y UN TOKEN QUE NO EXISTE DEVUELVEN LO MISMO
 * (404). Cualquier diferencia entre esos dos casos es un oráculo para ir
 * adivinando tokens.
 *
 * 🔴 SE DEVUELVE SOLO LO QUE EL PACIENTE TIENE QUE VER: ni el paciente, ni
 * el caso, ni quién lo hizo, ni el instituto. Una URL con token que se
 * comparte por WhatsApp acaba en más manos de las previstas.
 *
 * ⚠️ El rate limit es el `rateLimit` en memoria del repo, por IP: frena a
 * una persona insistiendo, no a un atacante distribuido. Es exactamente lo
 * que hace la ruta pública del consentimiento, y subir de ahí exige un
 * contador persistente.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — el paciente lee su presupuesto. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 30);
  if (rl) return rl;
  try {
    const q = await getEduQuotePorToken(params.token);
    if (!q) return NextResponse.json({ error: "Ese enlace no es válido." }, { status: 404 });
    return NextResponse.json(q);
  } catch {
    return NextResponse.json({ error: "No se pudo abrir el presupuesto." }, { status: 500 });
  }
}

/**
 * POST — el paciente lo ACEPTA, con su nombre y la evidencia.
 *
 * 🔴 EL `where` DEL updateMany LLEVA `status: "PRESENTADO"`, y ése es todo
 * el candado contra el doble toque desde un teléfono con mala señal: la
 * segunda petición escribe cero filas y contesta que ya estaba aceptado,
 * en vez de pisar la hora y la evidencia de la primera.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 10);
  if (rl) return rl;
  try {
    const body = await req.json().catch(() => ({}));
    const fwd = req.headers.get("x-forwarded-for") ?? "";
    const r = await aceptarEduQuotePorToken(params.token, body, {
      ip: (fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null)?.slice(0, 60) ?? null,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof EduPadronError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[instituto] aceptar presupuesto público falló:", err);
    return NextResponse.json({ error: "No se pudo aceptar el presupuesto." }, { status: 500 });
  }
}
