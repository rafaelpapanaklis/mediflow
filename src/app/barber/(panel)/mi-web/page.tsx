export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import { rutaWebBarberia } from "@/lib/barber/landing";
import { cargarBarberWeb } from "@/app/b/[slug]/_shared/shop-data";
import { prisma } from "@/lib/prisma";
import { loadWebTienda } from "@/lib/barber/tienda";
import { rutaProductoTienda, rutaTienda } from "@/lib/barber/tienda-core";
import { EditorWebBarberia } from "@/components/barber/landing/editor";
import { UpsellWebBarberia } from "@/components/barber/landing/upsell";

/* ═══════════════════════════════════════════════════════════════════════
   /barber/mi-web — LAS TRES PUERTAS, EN EL SERVIDOR.

   1. Sesión de barbería. Sin ella, al login compartido.
   2. Permiso `web.edit`. Sin él, un aviso que dice a quién pedírselo.
   3. Plan con `miniWebEditor` (Avanzado y Profesional). Sin él, la
      pantalla de Básico: SU página, su liga y su QR, sin editor.

   Las tres son de verdad, no de adorno. El sidebar ya esconde el item
   "Mi web" en Básico (BARBER_NAV_ITEMS lo declara con featureKey
   miniWebEditor), pero esconder un botón no es un candado: quien escriba
   la ruta a mano llega igual. Y el mismo gate está OTRA VEZ en
   /api/barber/landing, porque el que manda es el que escribe en la base.

   Los datos salen del MISMO cargador que la página pública
   (b/[slug]/_shared/shop-data.ts). No es reutilización por comodidad: es
   la garantía de que la vista previa del editor no puede enseñar un dato
   que la página real no tenga, ni al revés.
   ═══════════════════════════════════════════════════════════════════════ */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export default async function PaginaMiWeb() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const t = getBarberT(ctx.barbershop.locale);
  const dict = getBarberDict(ctx.barbershop.locale);

  const puedeEditar = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "web.edit",
  );

  if (!puedeEditar) {
    return (
      <div className="dcbwe">
        <div className="dcbwe-alerta">
          <strong>{t("barber.web.sinPermisoTitulo")}</strong>
          <p>{t("barber.web.sinPermisoCuerpo")}</p>
        </div>
      </div>
    );
  }

  const carga = await cargarBarberWeb(ctx.barbershop.slug);
  if (!carga) {
    // La barbería de la sesión no se encuentra por su slug: o está
    // desactivada, o el slug cambió debajo. No hay nada que editar.
    redirect("/barber/inicio");
  }

  const urlPublica = `${SITE_URL}${rutaWebBarberia(ctx.barbershop.slug)}`;
  const plan = await getBarberPlan(ctx.barbershop.plan);
  // Turnos de los barberos activos de ESTA sede: alimentan «Tomar el horario de mis barberos».
  const turnosBarberos = await prisma.barberSchedule
    .findMany({
      where: { barbershopId: ctx.barbershop.id, isActive: true, barber: { isActive: true } },
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    })
    .catch(() => []);

  if (plan.features.miniWebEditor !== true) {
    return (
      <UpsellWebBarberia
        dict={dict}
        data={{ ...carga.data, editando: false }}
        urlPublica={urlPublica}
      />
    );
  }

  // Sección «Tienda»: los mismos productos que pinta la página pública. Sin
  // plan con productos o sin el SQL de la tienda, el editor no la ofrece.
  const webTienda = await loadWebTienda(ctx.barbershop.id);
  const slug = carga.data.shop.slug;

  return (
    <EditorWebBarberia
      tienda={{
        disponible: webTienda.disponible,
        total: webTienda.total,
        url: rutaTienda(slug),
        productos: webTienda.products.map((p) => ({
          id: p.id,
          nombre: p.name,
          precio: p.price,
          fotoUrl: p.photoUrl,
          categoria: p.category,
          url: rutaProductoTienda(slug, p.id),
          agotado: p.available <= 0,
        })),
      }}
      dict={dict}
      shop={carga.data.shop}
      servicios={carga.data.servicios}
      barberos={carga.data.barberos}
      template={carga.data.manifest.id}
      config={carga.data.config}
      version={carga.version}
      publishedAtIso={carga.publishedAt ? carga.publishedAt.toISOString() : null}
      urlPublica={urlPublica}
      sinTabla={carga.sinTabla}
      turnosBarberos={turnosBarberos}
    />
  );
}
