import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import {
  PORTAL_ISSUE_MAX_PHOTOS,
  PORTAL_ISSUE_MAX_PHOTO_BYTES,
  PORTAL_ISSUE_MAX_TOTAL_BYTES,
  checkTenantIssueSlot,
  createTenantIssue,
  getTenantScope,
  loadTenantIssues,
  normalizeIssueText,
  photoExtension,
  portalCsrfBlocked,
  portalUnauthorized,
  removePortalPhotos,
  sniffImageMime,
  uploadPortalPhoto,
} from "@/lib/realty/portal-auth";

/**
 * Foto rechazada a mitad del bucle. Se lanza para poder BORRAR en un solo
 * sitio lo que ya se había subido antes de devolver el error: un `return`
 * dentro del bucle dejaría los archivos anteriores huérfanos en el bucket.
 */
class PhotoRechazada extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PhotoRechazada";
    this.status = status;
  }
}

/**
 * Fallas del inmueble reportadas por el inquilino.
 *
 *   GET  → sus reportes y cómo van.
 *   POST → uno nuevo, con fotos (multipart).
 *
 * 🔴 EL INMUEBLE NO VIENE DEL CUERPO. Llega un leaseId, se comprueba
 * contra el cerco de la sesión (los contratos de ESE teléfono en ESA
 * cuenta) y el propertyId se deriva del contrato ya verificado. Un
 * contrato ajeno no da 403 con pistas: da "no encontramos ese contrato".
 *
 * Alimenta el módulo de mantenimiento del panel (T4): la fila que se crea
 * aquí es un RealtyMaintenance normal, con reportedBy = el nombre con el
 * que la persona está capturada.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const scope = await getTenantScope();
  if (!scope) return portalUnauthorized();
  try {
    return NextResponse.json({ ok: true, issues: await loadTenantIssues(scope) });
  } catch (err) {
    console.error("[realty/portal/fallas] GET error:", err);
    return NextResponse.json({ error: "No pudimos cargar tus reportes." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const csrf = portalCsrfBlocked(req);
  if (csrf) return csrf;

  const limited = await persistentRateLimit(req, {
    limit: 12,
    windowSec: 600,
    scope: "realty-portal-falla",
  });
  if (limited) return limited;

  const scope = await getTenantScope();
  if (!scope) return portalUnauthorized();

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No llegó el reporte." }, { status: 400 });
    }

    const leaseId = String(form.get("leaseId") ?? "");
    const description = normalizeIssueText(form.get("description"));
    if (!description) {
      return NextResponse.json(
        { error: "Escribe un poco más para que entiendan qué pasa." },
        { status: 400 },
      );
    }
    // 🔴 TODO LO QUE PUEDE RECHAZAR EL REPORTE SE COMPRUEBA **ANTES** DE
    // SUBIR UN SOLO BYTE: que el contrato sea suyo y que le quede cupo de
    // reportes abiertos. Si no, un inquilino con el cupo lleno gasta sus
    // datos móviles subiendo cuatro fotos que acaban huérfanas en el bucket,
    // sin que nadie las cuente ni las recoja.
    const slot = await checkTenantIssueSlot(scope, leaseId);
    if (!slot.ok) {
      return NextResponse.json(
        { error: slot.error ?? "No encontramos ese contrato." },
        { status: slot.error?.startsWith("Ya tienes") ? 400 : 404 },
      );
    }

    const archivos = form.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);
    if (archivos.length > PORTAL_ISSUE_MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Puedes mandar hasta ${PORTAL_ISSUE_MAX_PHOTOS} fotos.` },
        { status: 400 },
      );
    }

    const photoUrls: string[] = [];
    let bytesSubidos = 0;

    try {
      for (const archivo of archivos) {
        if (archivo.size > PORTAL_ISSUE_MAX_PHOTO_BYTES) {
          throw new PhotoRechazada("Esa foto pesa demasiado. Intenta con otra.", 413);
        }
        const bytes = new Uint8Array(await archivo.arrayBuffer());
        // Tope de TODA la petición, no solo por foto.
        if (bytesSubidos + bytes.length > PORTAL_ISSUE_MAX_TOTAL_BYTES) {
          throw new PhotoRechazada("Son demasiadas fotos juntas. Manda menos.", 413);
        }
        // El Content-Type del multipart lo escribe el cliente: aquí se lee el
        // tipo REAL por firma de bytes.
        const mime = sniffImageMime(bytes);
        if (!mime) {
          throw new PhotoRechazada("Ese archivo no es una imagen (solo JPG, PNG o WebP).", 400);
        }
        const path = `${scope.accountId}/mantenimiento/${leaseId}/${randomUUID()}.${photoExtension(mime)}`;
        await uploadPortalPhoto(path, bytes, mime);
        // Se guarda el PATH interno, no una URL: el bucket es privado y la
        // liga se firma on-demand cuando alguien la va a ver.
        photoUrls.push(path);
        bytesSubidos += bytes.length;
      }
    } catch (err) {
      // Lo que ya subió no se queda de recuerdo.
      await removePortalPhotos(photoUrls);
      if (err instanceof PhotoRechazada) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const created = await createTenantIssue(scope, { leaseId, description, photoUrls });
    if (!created.ok) {
      // Carrera: entre la comprobación y el insert se llenó el cupo.
      await removePortalPhotos(photoUrls);
      return NextResponse.json(
        { error: created.error ?? "No pudimos mandar tu reporte." },
        { status: 400 },
      );
    }

    // Contabilidad del cupo. Best-effort: si falla, el reporte YA está
    // creado y perderlo por un contador sería absurdo.
    if (bytesSubidos > 0) {
      try {
        await prisma.realtyAccount.update({
          where: { id: scope.accountId },
          data: { storageUsedBytes: { increment: BigInt(bytesSubidos) } },
        });
      } catch (err) {
        console.error("[realty/portal/fallas] no se pudo sumar el consumo:", err);
      }
    }

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    console.error("[realty/portal/fallas] POST error:", err);
    return NextResponse.json(
      { error: "No pudimos mandar tu reporte. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
