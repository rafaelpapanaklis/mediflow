export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AnnouncementsClient } from "./announcements-client";

export const metadata: Metadata = { title: "Anuncios globales — Admin MediFlow" };

export default async function AdminAnnouncementsPage() {
  const announcements = await prisma.adminAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
  });
  return <AnnouncementsClient initial={announcements as any} />;
}
