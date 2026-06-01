export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";
import { LabSidebar } from "@/components/laboratorios/lab-sidebar";
import { LabTopbar } from "@/components/laboratorios/lab-topbar";

export default async function LabPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");
  if (ctx.status !== "APPROVED") redirect("/laboratorios/pendiente");

  return (
    <div className="dashboard-shell flex min-h-screen font-sans">
      <LabSidebar
        labName={ctx.lab.name}
        logoUrl={ctx.lab.logoUrl ?? null}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <LabTopbar labName={ctx.lab.name} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pt-20 lg:pt-6"
          style={{
            padding: "clamp(12px, 1.5vw, 28px)",
            paddingTop: "clamp(16px, 2vw, 24px)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
