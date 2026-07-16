import { AdminSidebar } from "./admin-nav";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";
import AdminLoginPage from "./login/page";
import "@/app/panel-chrome-va.css";

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
  // Defensa en profundidad (CVE-2025-29927): no depender solo del middleware.
  // /admin/login vive BAJO este layout, así que redirect("/admin/login") aquí
  // haría loop infinito para el visitante sin cookie; en su lugar se renderiza
  // el login y children (las páginas admin) nunca llega al cliente.
  if (!(await isAdminAuthed())) {
    return <AdminLoginPage />;
  }

  const counts = await getNavCounts();

  return (
    <div className="mf-extpanel" style={{ display: "flex", minHeight: "100vh", color: "var(--text-1)" }}>
      <AdminSidebar counts={counts} />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, padding: "28px 28px 40px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
