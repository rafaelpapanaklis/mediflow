import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { SupplierRegistroForm } from "@/components/proveedores/supplier-registro-form";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Regístrate como proveedor · MediFlow",
  description: "Crea tu cuenta de proveedor en MediFlow y vende tus insumos a clínicas dentales.",
  robots: { index: false, follow: false },
};

export default function SupplierRegistroPage() {
  return <AuthShell split="60/40" visual={<LoginVisual />} form={<SupplierRegistroForm />} />;
}
