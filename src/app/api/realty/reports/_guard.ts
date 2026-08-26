import { NextResponse } from "next/server";
import { getRealtyContext, type RealtyContext } from "@/lib/realty-auth";
import { loadAccountLogo } from "@/lib/realty/media";
import { safeFileName } from "@/lib/realty/owner-report";
import {
  getReportAccess,
  resolveRange,
  type ReportAccess,
} from "@/lib/realty/reports";
import type { PdfBrand } from "@/components/realty/reports/report-pdf";

/* ═══════════════════════════════════════════════════════════════════════
   PUERTA ÚNICA de /api/realty/reports/**.

   🔴 LA REJA DE ESTAS RUTAS NO ES COMO LA DE LAS DEMÁS DEL VERTICAL.
   El item de menú "reportes" pide SOLO `properties.view`, no tiene
   featureKey y está en TODOS los modos — y así debe ser: un asesor tiene
   que poder ver su embudo y un rentista su rendimiento. Pero con esa sola
   llave, un AGENT descargaría el PDF del resumen fiscal con el dinero
   completo de la cartera.

   Por eso aquí el permiso abre la PUERTA y **cada bloque comprueba el
   SUYO**, con el MISMO `getReportAccess` que decide qué pestañas se pintan
   en pantalla. Un solo lugar donde vive la respuesta a "¿quién puede ver
   esto?": si la exportación tuviera su propio criterio, el día que alguien
   ajuste uno se abriría un agujero en el otro y nadie se enteraría.

   Esconder una pestaña no es control de acceso. Estas rutas son la prueba:
   se llega a ellas escribiendo la URL a mano.
   ═══════════════════════════════════════════════════════════════════════ */

export type ReportBlock = keyof Pick<
  ReportAccess,
  "activity" | "portfolio" | "tax" | "profitability" | "funnel" | "commissions" | "collections"
>;

export type ReportGate = { ctx: RealtyContext; access: ReportAccess } | { response: NextResponse };

export function isDenied(gate: ReportGate): gate is { response: NextResponse } {
  // Guarda de tipo EXPLÍCITA: el repo compila con `strict: false` y ahí
  // TypeScript no estrecha una unión por la presencia de una propiedad.
  return (gate as { response?: NextResponse }).response !== undefined;
}

/**
 * Sesión → puerta (`properties.view`) → bloque. En ese orden, y ninguno se
 * puede saltar: el accountId sale SIEMPRE del contexto, jamás del request.
 *
 * `blocks` es un OR: la pantalla de operación pinta lo que el usuario pueda
 * ver, así que su exportación entra si tiene alguno de los tres, y luego
 * cada bloque del archivo se arma o no según el suyo (getOperationsReport
 * ya consulta solo lo que toca).
 */
export async function gateReport(...blocks: ReportBlock[]): Promise<ReportGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const access = getReportAccess(ctx);
  if (!access.base) {
    return {
      response: NextResponse.json(
        { error: "No tienes permiso para ver los reportes.", code: "FORBIDDEN" },
        { status: 403 },
      ),
    };
  }

  if (blocks.length > 0 && !blocks.some((b) => access[b])) {
    return {
      response: NextResponse.json(
        {
          error: "No tienes permiso para esta parte del reporte, o tu plan no la incluye.",
          code: "FORBIDDEN",
        },
        { status: 403 },
      ),
    };
  }

  return { ctx, access };
}

/** El periodo del query, ya recortado a la zona horaria de la cuenta. */
export function rangeFromQuery(ctx: RealtyContext, sp: URLSearchParams) {
  return resolveRange(ctx, sp.get("from"), sp.get("to"));
}

/** Un año válido del query. Fuera de rango, el año en curso de la cuenta. */
export function yearFromQuery(ctx: RealtyContext, sp: URLSearchParams): number {
  const tz = ctx.account.timezone || "America/Mexico_City";
  let actual: number;
  try {
    actual = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()),
    );
  } catch {
    actual = new Date().getUTCFullYear();
  }
  const raw = Number(sp.get("year"));
  return Number.isInteger(raw) && raw > 2000 && raw <= actual + 1 ? raw : actual;
}

/**
 * Cartera o rentabilidad. Cualquier otra cosa es la cartera: una variante
 * mal escrita en la URL no puede ser un 400 en un botón de descarga.
 *
 * Vive aquí y no en el `route.ts` porque un route handler de Next SOLO
 * puede exportar los verbos y su configuración — cualquier otro export
 * truena el build con "is not a valid Route export field".
 */
export function variantFromQuery(sp: URLSearchParams): "cartera" | "rentabilidad" {
  return sp.get("variant") === "rentabilidad" ? "rentabilidad" : "cartera";
}

/** El id del query, o null. Nada llega crudo a Prisma sin pasar por aquí. */
export function idFromQuery(sp: URLSearchParams, key: string): string | null {
  const raw = (sp.get(key) ?? "").trim();
  if (!raw) return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

/**
 * El membrete. El logo se reduce a 140 px y se incrusta como data URI: una
 * imagen remota dentro de un PDF es una petición que puede fallar justo
 * cuando el propietario abre su reporte.
 */
export async function brandFor(ctx: RealtyContext): Promise<PdfBrand> {
  const account = ctx.account;
  let logoSrc: string | null = null;
  try {
    const buf = await loadAccountLogo(account.logoUrl, ctx.accountId);
    if (buf) {
      const sharp = (await import("sharp")).default;
      const out = await sharp(buf, { failOn: "none" })
        .resize({ width: 140, withoutEnlargement: true })
        .png()
        .toBuffer();
      logoSrc = `data:image/png;base64,${out.toString("base64")}`;
    }
  } catch {
    // Sin logo el reporte sale igual, solo con el nombre. Nunca al revés:
    // que no se pueda leer una imagen no puede impedir una descarga.
    logoSrc = null;
  }

  return {
    name: account.name,
    logoSrc,
    licenseLine: account.licenseNumber
      ? `Licencia ${account.licenseNumber}${account.licenseState ? ` · ${account.licenseState}` : ""}`
      : null,
    phone: account.phone ?? null,
    email: account.email ?? null,
  };
}

/**
 * Respuesta de hoja de cálculo.
 *
 * `private, no-store`: estas hojas llevan el dinero de una cuenta concreta
 * y ninguna caché intermedia debe quedarse con ellas.
 */
export function csvResponse(body: string, base: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFileName(base, "csv")}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}

/**
 * Respuesta de PDF. `inline` a propósito: el asesor lo abre, lo revisa y
 * decide si lo manda; forzar la descarga lo obligaría a buscarlo en su
 * carpeta antes de poder verlo.
 */
export function pdfResponse(buffer: Buffer, base: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFileName(base, "pdf")}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}

/** 500 con el detalle SOLO en el log: una traza filtra rutas y consultas. */
export function reportError(scope: string, e: unknown): NextResponse {
  console.error(`[api/realty/reports/${scope}]`, e);
  return NextResponse.json({ error: "No se pudo generar el reporte." }, { status: 500 });
}
