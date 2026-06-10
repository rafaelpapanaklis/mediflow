import { Suspense } from "react";
import { PacienteVerificarForm } from "@/components/paciente/auth/verificar-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verifica tu correo · DaleControl" };

export default function PacienteVerificarPage() {
  return (
    <Suspense fallback={null}>
      <PacienteVerificarForm />
    </Suspense>
  );
}
