import { Suspense } from "react";
import { PacienteRecuperarForm } from "@/components/paciente/auth/recuperar-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recupera tu contraseña · DaleControl" };

export default function PacienteRecuperarPage() {
  return (
    <Suspense fallback={null}>
      <PacienteRecuperarForm />
    </Suspense>
  );
}
