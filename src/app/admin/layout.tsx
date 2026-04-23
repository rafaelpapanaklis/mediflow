import { AdminSidebar } from "./admin-nav";
import { prisma } from "@/lib/prisma";

async function getNavCounts() {
  try {
    const [clinics, atRisk] = await Promise.all([
      prisma.clinic.count().catch(() => 0),
      prisma.clinic.count({
        where: {
          subscriptionStatus: { in: ["trialing", "past_due"] },
        },
      }).catch(() => 0),
    ]);
    return { clinics, atRisk };
  } catch {
    return { clinics: 0, atRisk: 0 };
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const counts = await getNavCounts();

  return (
    <div style={{ display: "flex", minHeight: "100vh", color: "var(--text-1)" }}>
      <AdminSidebar counts={counts} />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, padding: "28px 28px 40px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
