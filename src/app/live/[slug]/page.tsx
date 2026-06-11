export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import type { Metadata } from "next";
import { AlertCircle, Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { liveCookieName } from "@/lib/floor-plan/live-config";
import { PasswordGate } from "./password-gate";
import { LivePublicClient } from "./live-public-client";
import liveStyles from "./live-public.module.css";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // noindex también en el fallback: la página "no disponible" responde 200
  // (ya no notFound()) y no debe indexarse.
  const fallback: Metadata = {
    title: "Vista pública",
    robots: { index: false, follow: false },
  };
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { liveModeSlug: params.slug.toLowerCase() },
      select: { name: true, liveModeEnabled: true },
    });
    if (!clinic || !clinic.liveModeEnabled) return fallback;
    return {
      title: `${clinic.name} · vista en vivo`,
      robots: { index: false, follow: false },
    };
  } catch (err) {
    // Migración liveMode* faltante o DB caída — no tirar 500 por metadata.
    console.error("[/live/[slug]]", err);
    return fallback;
  }
}

export default async function LivePublicPage({ params }: Props) {
  const slug = params.slug.toLowerCase();

  // La migración 20260428100000_clinic_layout (columnas liveMode* en
  // clinics) puede faltar en prod, o la DB puede estar caída: la query
  // NO debe tirar un 500 pelado en una página pública. OJO: dentro del
  // try no va ningún notFound()/redirect() — lanzan excepciones de
  // control de Next y el catch se las tragaría.
  let clinic: {
    id: string;
    name: string;
    logoUrl: string | null;
    city: string | null;
    liveModeEnabled: boolean;
    liveModePassword: string | null;
    liveModeShowPatientNames: boolean;
  } | null = null;
  let dbFailed = false;
  try {
    clinic = await prisma.clinic.findUnique({
      where: { liveModeSlug: slug },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        city: true,
        liveModeEnabled: true,
        liveModePassword: true,
        liveModeShowPatientNames: true,
      },
    });
  } catch (err) {
    console.error("[/live/[slug]]", err);
    dbFailed = true;
  }

  if (dbFailed) {
    return <LiveUnavailable variant="error" slug={slug} />;
  }

  // Slug inexistente, clínica sin liveModeSlug o liveModeEnabled=false:
  // antes era notFound() (404 genérico); ahora mensaje claro y amable.
  if (!clinic || !clinic.liveModeEnabled) {
    return <LiveUnavailable variant="not_available" slug={slug} />;
  }

  // Si tiene password y no hay cookie unlock, mostramos el gate.
  const hasPassword = Boolean(clinic.liveModePassword);
  if (hasPassword) {
    const cookie = cookies().get(liveCookieName(slug));
    if (cookie?.value !== "1") {
      return <PasswordGate slug={slug} clinicName={clinic.name} />;
    }
  }

  return (
    <LivePublicClient
      slug={slug}
      clinicName={clinic.name}
      logoUrl={clinic.logoUrl ?? null}
      city={clinic.city ?? null}
      showPatientNames={clinic.liveModeShowPatientNames}
    />
  );
}

/**
 * Página simple y elegante de "no disponible" (server-rendered, sin JS).
 * Reutiliza las clases de error del CSS module de la vista pública.
 * - not_available: slug inexistente, clínica sin liveModeSlug o
 *   liveModeEnabled=false.
 * - error: la query a la DB reventó (migración faltante o DB caída);
 *   ofrece reintentar con un link a la misma URL.
 */
function LiveUnavailable({
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
            ? "No pudimos cargar esta página"
            : "Esta página no está disponible"}
        </h1>
        <p>
          {isError
            ? "Ocurrió un problema temporal al cargar la información. Intenta de nuevo en unos momentos."
            : "El enlace puede ser incorrecto, o la clínica aún no habilitó su vista en vivo. Verifica la dirección o solicita a la clínica un enlace actualizado."}
        </p>
        {isError && (
          <a
            href={`/live/${encodeURIComponent(slug)}`}
            className={liveStyles.errorBtn}
            style={{ textDecoration: "none", display: "inline-block" }}
          >
            Reintentar
          </a>
        )}
      </div>
    </div>
  );
}
