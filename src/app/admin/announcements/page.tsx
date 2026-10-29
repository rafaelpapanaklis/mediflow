export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AnnouncementsClient } from "./announcements-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const metadata: Metadata = { title: "Anuncios globales — Admin DaleControl" };

export default async function AdminAnnouncementsPage() {
  await requireAdminPage();
  const announcements = await prisma.adminAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
  });
  return <AnnouncementsClient initial={announcements as any} />;
}
