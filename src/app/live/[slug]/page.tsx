export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { liveCookieName } from "@/lib/floor-plan/live-config";
import { PasswordGate } from "./password-gate";
import { LivePublicClient } from "./live-public-client";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const clinic = await prisma.clinic.findUnique({
    where: { liveModeSlug: params.slug.toLowerCase() },
    select: { name: true, liveModeEnabled: true },
  });
  if (!clinic || !clinic.liveModeEnabled) return { title: "Vista pública" };
  return {
    title: `${clinic.name} · vista en vivo`,
    robots: { index: false, follow: false },
  };
}

export default async function LivePublicPage({ params }: Props) {
  const slug = params.slug.toLowerCase();
  const clinic = await prisma.clinic.findUnique({
    where: { liveModeSlug: slug },
    select: {
      id: true,
      name: true,
      liveModeEnabled: true,
      liveModePassword: true,
      liveModeShowPatientNames: true,
    },
  });
  if (!clinic || !clinic.liveModeEnabled) notFound();

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
      showPatientNames={clinic.liveModeShowPatientNames}
    />
  );
}
