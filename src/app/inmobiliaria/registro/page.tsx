import type { Metadata } from "next";
import { AuthShell } from "@/components/public/auth/auth-shell";
import { RealtyRegistroVisual } from "@/components/realty/realty-registro-visual";
import { RealtyRegistroForm } from "@/components/realty/realty-registro-form";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";

// Dynamic: la página de registro no debe prerenderizarse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Da de alta tu inmobiliaria · DaleControl Inmuebles",
  description:
    "Crea tu cuenta en DaleControl Inmuebles: cartera con recorridos 3D, prospectos, contratos de renta y tu web pública.",
  robots: { index: false, follow: false },
};

export default function RealtyRegistroPage() {
  // CONVENCIÓN B: el servidor recorta el sub-árbol y el cliente NO antepone
  // prefijo. Está escrito aquí y en el componente para que no se crucen las
  // dos convenciones (que es el bug que pintó llaves crudas en barber).
  const dict = (getRealtyDict("es").realty as Dictionary).registro as Dictionary;

  return (
    <AuthShell
      split="60/40"
      visualVariant="dark"
      visual={<RealtyRegistroVisual />}
      form={<RealtyRegistroForm dict={dict} />}
    />
  );
}
