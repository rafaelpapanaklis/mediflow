import { AdminSidebar } from "./admin-nav";
import { prisma } from "@/lib/prisma";
import { getAdminSessionResult } from "@/lib/admin-auth";
import { countAdminPendingReply } from "@/lib/support/service";
import { countAffiliateSupportPendingReply } from "@/lib/affiliate-support/service";
import { countPagesPendingReview } from "@/lib/affiliates/page-moderation";
import { crmContarPendientes } from "@/lib/admin/crm/service";
import AdminLoginPage from "./login/page";
import { AdminSessionError } from "./session-error";
import { AdminSessionKeepalive } from "./session-keepalive";
import "@/app/panel-chrome-va.css";

async function getNavCounts() {
  try {
    const [clinics, atRisk, supportPending, affiliateSupportPending, affiliatePagesPending, crmPendientes] = await Promise.all([
      prisma.clinic.count().catch(() => 0),
      prisma.clinic.count({
        where: {
          subscriptionStatus: { in: ["trialing", "past_due"] },
        },
      }).catch(() => 0),
      countAdminPendingReply(), // ya trae su propio try/catch → 0 si falla
      // Tickets de afiliados esperando respuesta. Con .catch propio: mientras el
      // SQL de affiliate_support_* no esté aplicado la consulta lanza y el
      // sidebar entero no puede caerse por un badge.
      countAffiliateSupportPendingReply().catch(() => 0),
      // Páginas de socio esperando revisión. countPagesPendingReview ya trae su
      // propio try/catch → 0 si la consulta falla.
      countPagesPendingReview(),
      // Prospectos del CRM con seguimiento vencido o para hoy. Ya trae su
      // propio try/catch → 0 si las tablas del CRM aún no existen; un badge
      // no puede tumbar el sidebar entero.
      crmContarPendientes(),
    ]);
    return { clinics, atRisk, supportPending, affiliateSupportPending, affiliatePagesPending, crmPendientes };
  } catch {
    return {
      clinics: 0,
      atRisk: 0,
      supportPending: 0,
      affiliateSupportPending: 0,
      affiliatePagesPending: 0,
      crmPendientes: 0,
    };
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Defensa en profundidad (CVE-2025-29927): no depender solo del middleware.
  // /admin/login vive BAJO este layout, así que redirect("/admin/login") aquí
  // haría loop infinito para el visitante sin cookie; en su lugar se renderiza
  // el login y children (las páginas admin) nunca llega al cliente.
  //
  // Tres estados, no dos: un fallo de BD NO puede pedir credenciales (era la
  // causa de que el panel expulsara al admin cada pocos minutos). Ojo con el
  // orden: sólo "anonymous" muestra el login.
  const session = await getAdminSessionResult();
  if (session.state === "error") {
    return <AdminSessionError />;
  }
  if (session.state === "anonymous") {
    return <AdminLoginPage />;
  }

  const counts = await getNavCounts();

  return (
    <div className="mf-extpanel" style={{ display: "flex", minHeight: "100vh", color: "var(--text-1)" }}>
      <AdminSessionKeepalive />
      <AdminSidebar counts={counts} />
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, padding: "28px 28px 40px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
