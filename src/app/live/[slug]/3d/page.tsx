export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import type { Metadata } from "next";
import { AlertCircle, Building2, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { liveCookieName, verifyLiveUnlockCookie } from "@/lib/floor-plan/live-config";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { sanitizeElements, sanitizeMetadata } from "@/lib/floor-plan/sanitize";
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PasswordGate } from "../password-gate";
import { Clinic3DPublicMount } from "./Clinic3DPublicMount";
import liveStyles from "../live-public.module.css";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // noindex SIEMPRE: es la cara pública de la clínica, no debe indexarse.
  const fallback: Metadata = {
    title: "Recorrido 3D",
    robots: { index: false, follow: false },
  };
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { liveModeSlug: params.slug.toLowerCase() },
      select: { name: true, liveModeEnabled: true },
    });
    if (!clinic || !clinic.liveModeEnabled) return fallback;
    return {
      title: `${clinic.name} · recorrido 3D`,
      robots: { index: false, follow: false },
    };
  } catch (err) {
    console.error("[/live/[slug]/3d]", err);
    return fallback;
  }
}

/**
 * Versión PÚBLICA de Mi Clínica 3D. Los pacientes recorren la clínica en 3D
 * desde el link "En Vivo", con la MISMA protección y privacidad que el 2D:
 * - clínica por liveModeSlug + liveModeEnabled (o pantalla amable),
 * - gate de password con la cookie firmada (verifyLiveUnlockCookie),
 * - datos enmascarados server-side (el cliente pollea /api/live/[slug]).
 *
 * force-dynamic: leemos cookies para el unlock → JAMÁS ISR/revalidate aquí, y
 * NUNCA leemos searchParams (lección DYNAMIC_SERVER_USAGE de hoy).
 *
 * Patrón defensivo idéntico a /live/[slug]/page.tsx: la query NO debe tirar un
 * 500 pelado; dentro del try NO va notFound()/redirect() (lanzan y el catch se
 * los tragaría).
 */
export default async function Live3DPage({ params }: Props) {
  const slug = params.slug.toLowerCase();

  let clinic: {
    id: string;
    name: string;
    category: string;
    liveModeEnabled: boolean;
    liveModePassword: string | null;
  } | null = null;
  let dbFailed = false;
  try {
    clinic = await prisma.clinic.findUnique({
      where: { liveModeSlug: slug },
      select: {
        id: true,
        name: true,
        category: true,
        liveModeEnabled: true,
        liveModePassword: true,
      },
    });
  } catch (err) {
    console.error("[/live/[slug]/3d]", err);
    dbFailed = true;
  }

  if (dbFailed) return <Live3DUnavailable variant="error" slug={slug} />;
  if (!clinic || !clinic.liveModeEnabled) {
    return <Live3DUnavailable variant="not_available" slug={slug} />;
  }

  // Gate de password: misma cookie firmada (HMAC + expiración) que el 2D. Al
  // desbloquear, el PasswordGate hace location.reload() → recarga ESTA url
  // (/3d) → cookie válida → entra directo al recorrido 3D.
  if (clinic.liveModePassword) {
    const cookie = cookies().get(liveCookieName(slug));
    if (!verifyLiveUnlockCookie(cookie?.value, slug)) {
      return <PasswordGate slug={slug} clinicName={clinic.name} />;
    }
  }

  // Geometría del mundo (layout + sillones). El estado VIVO de los sillones lo
  // refresca el cliente por polling a /api/live/[slug] — mismos datos
  // enmascarados que consume la vista 2D, adaptados al contrato del mundo 3D.
  let elements: LayoutElement[] = [];
  let metadata: LayoutMetadata | null = null;
  let chairs: { id: string; name: string; color: string | null }[] = [];
  try {
    const [layout, chairRows] = await Promise.all([
      prisma.clinicLayout.findUnique({ where: { clinicId: clinic.id } }),
      prisma.resource.findMany({
        where: { clinicId: clinic.id, kind: { in: [...TREATMENT_KINDS] }, isActive: true },
        select: { id: true, name: true, color: true, orderIndex: true },
        orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      }),
    ]);
    elements = sanitizeElements(layout?.elements);
    metadata = sanitizeMetadata(layout?.metadata);
    chairs = chairRows.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null }));
  } catch (err) {
    console.error("[/live/[slug]/3d] layout", err);
    return <Live3DUnavailable variant="error" slug={slug} />;
  }

  return (
    <ErrorBoundary fallbackTitle="No se pudo cargar el recorrido 3D">
      <Clinic3DPublicMount
        clinic={{ id: clinic.id, name: clinic.name, category: clinic.category }}
        initialElements={elements}
        initialMetadata={metadata}
        initialChairs={chairs}
        slug={slug}
      />
    </ErrorBoundary>
  );
}

/**
 * Pantalla "no disponible" server-rendered (sin JS), reutilizando las clases de
 * error del CSS module de la vista pública 2D. Siempre ofrece volver al 2D.
 */
function Live3DUnavailable({
  variant,
  slug,
}: {
  variant: "not_available" | "error";
  slug: string;
}) {
  const isError = variant === "error";
  return (
    <div className={liveStyles.errorWrap}>
      <div className={liveStyles.errorCard}>
        {isError ? (
          <AlertCircle size={32} aria-hidden style={{ color: "#EF4444" }} />
        ) : (
          <Building2 size={32} aria-hidden style={{ color: "#4A90E2" }} />
        )}
        <h1>
          {isError
            ? "No pudimos cargar el recorrido 3D"
            : "Este recorrido no está disponible"}
        </h1>
        <p>
          {isError
            ? "Ocurrió un problema temporal al cargar la clínica. Intenta de nuevo en unos momentos."
            : "El enlace puede ser incorrecto, o la clínica aún no habilitó su vista en vivo. Verifica la dirección o pide a la clínica un enlace actualizado."}
        </p>
        <a
          href={`/live/${encodeURIComponent(slug)}`}
          className={liveStyles.errorBtn}
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <ArrowLeft size={15} aria-hidden /> Ver plano 2D
        </a>
      </div>
    </div>
  );
}
