export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { SupplierSidebar } from "@/components/proveedores/supplier-sidebar";
import { SupplierTopbar } from "@/components/proveedores/supplier-topbar";

export default async function SupplierPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");
  if (ctx.status !== "APPROVED") redirect("/proveedores/pendiente");

  return (
    <div className="dashboard-shell flex min-h-screen font-sans">
      <SupplierSidebar
        businessName={ctx.supplier.businessName}
        logoUrl={ctx.supplier.logoUrl ?? null}
      />
      <div className="flex min-h-screen flex-1 flex-col lg:max-h-screen lg:overflow-y-auto">
        <SupplierTopbar businessName={ctx.supplier.businessName} />
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
