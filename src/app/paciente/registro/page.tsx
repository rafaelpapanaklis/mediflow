import { Suspense } from "react";
import { PacienteRegistroForm } from "@/components/paciente/auth/registro-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crea tu cuenta · DaleControl" };

export default function PacienteRegistroPage() {
  return (
    <Suspense fallback={null}>
      <PacienteRegistroForm />
    </Suspense>
  );
}
