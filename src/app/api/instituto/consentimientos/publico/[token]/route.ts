import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { EduPadronError } from "@/lib/edu/padron";
import { getEduConsentPublic, signEduConsentPublic } from "@/lib/edu/consentimientos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * API PÚBLICA DE LA CARTA — SIN SESIÓN. EL TOKEN ES LA CREDENCIAL.
 *
 * La usa /instituto/consentimiento/[token], que el paciente abre en su
 * teléfono desde una liga que le mandaron. Aquí NO hay getEduContext, no
 * hay permiso y no hay institutionId de sesión: todo lo que protege este
 * endpoint es lo que comprueba él mismo.
 *
 * Vive bajo `publico/` porque Next.js no admite dos segmentos dinámicos
 * con nombres distintos al mismo nivel (`[id]` y `[token]` serían un error
 * de build) y las rutas del panel ya usan `[id]`. Es la misma solución que
 * el dental tomó en /api/consent/public/[token].
 *
 * 🔴 UN TOKEN CON MALA FORMA Y UN TOKEN QUE NO EXISTE DEVUELVEN LO MISMO
 * (404). Cualquier diferencia entre esos dos casos —un 400 aquí, un 404
 * allá— es un oráculo para ir adivinando tokens.
 *
 * ⚠️ El rate limit es el `rateLimit` en memoria del repo, por IP. En
 * serverless cada instancia tiene su propio Map, así que frena a una
 * persona insistiendo y no a un atacante distribuido. Es exactamente lo
 * que hace el dental en su ruta pública equivalente; subir de ahí exige un
 * contador persistente, y meterlo aquí habría sido traerse `@/lib/failban`
 * y su Upstash al vertical por una puerta que todavía nadie ha usado.
 * Queda anotado en ORQUESTA.md.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — el paciente lee su carta. Marca `viewedAt` la primera vez. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 30);
  if (rl) return rl;

  try {
    const view = await getEduConsentPublic(params.token);
    if (!view) {
      return NextResponse.json({ error: "Esa carta no existe." }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (err) {
    console.error("[instituto] GET consentimiento público falló:", err);
    return NextResponse.json(
      { error: "No se pudo abrir la carta. Intenta de nuevo." },
      { status: 500 },
    );
  }
}

/**
 * POST — firma el paciente, o uno de los dos testigos.
 *
 * Un solo handler para los tres y no tres rutas: la lista de comprobaciones
 * es la misma (existe, no revocada, bytes que de verdad son una imagen) y
 * repartirla en tres archivos es cómo se llega a que el tercero se salte
 * una. Quién firma llega en `rol`, que es un conjunto CERRADO — no un
 * nombre de columna, que dejaría a un tercero escribiendo en el hueco del
 * docente.
 *
 * Límite más estrecho que el del GET: firmar escribe, y además sube bytes.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // 10 por minuto y no 5 como el dental: en una escuela el mostrador
  // recoge cartas en rachas y TODA la clínica sale por la misma IP, así
  // que un tope de 5 frena a la recepción antes que a nadie más.
  const rl = rateLimit(req, 10);
  if (rl) return rl;

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const xff = req.headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0].trim() : null) ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;

  try {
    const out = await signEduConsentPublic(params.token, body, {
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json(out);
  } catch (err) {
    // No se usa `eduApiError`: ése registra con el prefijo del panel y su
    // 500 genérico está escrito para alguien con sesión. Aquí quien lee el
    // mensaje es un paciente en su teléfono.
    if (err instanceof EduPadronError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[instituto] POST consentimiento público falló:", err);
    return NextResponse.json(
      { error: "No se pudo registrar la firma. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
