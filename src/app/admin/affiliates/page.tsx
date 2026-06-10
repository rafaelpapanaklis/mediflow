export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AffiliatesClient } from "./affiliates-client";

export const metadata: Metadata = { title: "Afiliados — Admin DaleControl" };

// Affiliate es global (sin clinicId): el admin ve TODOS los afiliados.
export default async function AdminAffiliatesPage() {
  const affiliates = await prisma.affiliate.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clinics: true } } },
  });
  return <AffiliatesClient initial={affiliates as any} />;
}
