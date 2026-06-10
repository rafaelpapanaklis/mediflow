import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { SupplierLoginForm } from "@/components/proveedores/supplier-login-form";

// Dynamic: el login no debe prerenderizarse (interactúa con sesión Supabase).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal de proveedores · DaleControl",
  description: "Accede al panel de proveedores de DaleControl para gestionar tu catálogo y pedidos.",
  robots: { index: false, follow: false },
};

export default function SupplierLoginPage() {
  return <AuthShell split="50/50" visual={<LoginVisual />} form={<SupplierLoginForm />} />;
}
