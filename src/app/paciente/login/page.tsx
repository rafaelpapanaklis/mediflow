import { Suspense } from "react";
import { PacienteLoginForm } from "@/components/paciente/auth/login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inicia sesión · DaleControl" };

export default function PacienteLoginPage() {
  return (
    <Suspense fallback={null}>
      <PacienteLoginForm />
    </Suspense>
  );
}
