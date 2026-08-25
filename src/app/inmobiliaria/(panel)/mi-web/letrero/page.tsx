export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { precioInmueble } from "@/lib/realty/landing";
import { SITE_URL } from "@/lib/seo";
import {
  GeneradorLetrero,
  type InmuebleLetrero,
} from "@/components/realty/web/editor/letrero";
import "@/components/realty/web/editor/editor.css";
import "./letrero.css";

/* ═══════════════════════════════════════════════════════════════════════
   /inmobiliaria/mi-web/letrero — el letrero imprimible con QR.

   Solo se ofrecen inmuebles PUBLICADOS: un letrero que apunta a una ficha
   despublicada manda al vecino a un 404, y ese cartón ya está clavado en
   una reja.
   ═══════════════════════════════════════════════════════════════════════ */

function tablaSinCrear(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2010";
}

export default async function PaginaLetrero() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const puedeEditar = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "web.edit" as RealtyPermissionKey,
  );
  if (!puedeEditar) redirect("/inmobiliaria/inicio");

  let inmuebles: InmuebleLetrero[] = [];
  try {
    const filas = await prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId, isPublished: true },
      select: {
        id: true,
        publicUrlSlug: true,
        title: true,
        kind: true,
        operation: true,
        price: true,
        rentPrice: true,
        currency: true,
        colonia: true,
        shortTermFolio: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    inmuebles = filas.map((f) => {
      const enRenta = f.operation === "RENTA";
      const monto = Number(enRenta ? (f.rentPrice ?? f.price) : f.price);
      return {
        ref: f.publicUrlSlug ?? f.id,
        titulo: f.title,
        kind: f.kind,
        operacion: f.operation,
        colonia: f.colonia,
        folio: f.shortTermFolio,
        precio: enRenta
          ? `${precioInmueble(monto, f.currency)} al mes`
          : precioInmueble(monto, f.currency),
      };
    });
  } catch (e) {
    if (!tablaSinCrear(e)) throw e;
  }

  return (
    <div className="realty-page">
      <div className="dcrwl-nopr">
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Letrero con QR</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14, maxWidth: "68ch", marginTop: 6 }}>
          El letrero de la reja sigue siendo el canal número uno en México, y casi nadie mide si
          sirve. Con este QR sí: quien lo escanee llega a la ficha y, si deja sus datos, entra a
          tus prospectos marcado como <strong>letrero</strong>.
        </p>
        <p style={{ marginTop: 8 }}>
          <a className="dcrwe-btn dcrwe-btn-sutil" href="/inmobiliaria/mi-web">
            ← Volver a Mi web
          </a>
        </p>
      </div>

      <GeneradorLetrero
        slug={ctx.account.slug}
        nombre={ctx.account.name}
        telefono={ctx.account.phone}
        inmuebles={inmuebles}
        baseUrl={SITE_URL}
      />
    </div>
  );
}
