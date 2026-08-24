import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { BarberRegistroVisual } from "@/components/barber/barber-registro-visual";
import { BarberRegistroForm } from "@/components/barber/barber-registro-form";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registra tu barbería · DaleControl Barber",
  description:
    "Crea la cuenta de tu barbería en DaleControl Barber: agenda, fila virtual, WhatsApp y caja.",
  robots: { index: false, follow: false },
};

export default function BarberRegistroPage() {
  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<BarberRegistroVisual />}
      form={<BarberRegistroForm />}
    />
  );
}
