import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { LoginVisual } from "@/components/public/auth/login/login-visual";
import { LabRegistroForm } from "@/components/laboratorios/lab-registro-form";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Regístrate como laboratorio · DaleControl",
  description: "Crea tu cuenta de laboratorio dental en DaleControl y atiende órdenes de clínicas.",
  robots: { index: false, follow: false },
};

export default function LabRegistroPage() {
  return <AuthShell split="60/40" visual={<LoginVisual />} form={<LabRegistroForm />} />;
}
