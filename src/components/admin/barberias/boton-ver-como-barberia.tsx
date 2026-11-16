"use client";

// «Ver como barbería» (ws6-t1, 16-nov): el botón «Ver como clínica» del dental
// (src/components/admin/boton-ver-como-clinica.tsx, que no se toca) para
// /admin/barberias. Un formulario POST de un solo botón, sin ventana ni motivo,
// que abre el panel /barber de ESA barbería como su dueño en una PESTAÑA NUEVA:
// /admin se queda donde estaba. La sesión dura 2 h, queda en la bitácora
// barber_admin_impersonation_sessions y la barra «Estás viendo como…» del
// panel la cierra con «Salir y volver a /admin».

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

export function verComoBarberiaAction(barbershopId: string): string {
  return `/api/admin/barberias/${encodeURIComponent(barbershopId)}/ver-como`;
}

export function BotonVerComoBarberia({
  barbershopId,
  etiqueta = "Ver como barbería",
  size,
}: {
  barbershopId: string;
  etiqueta?: string;
  size?: "sm";
}) {
  // La pestaña de /admin no navega: «Entrando…» solo un momento, para que no
  // se abran dos pestañas con un doble clic.
  const [entrando, setEntrando] = useState(false);
  useEffect(() => {
    if (!entrando) return;
    const t = setTimeout(() => setEntrando(false), 3000);
    return () => clearTimeout(t);
  }, [entrando]);

  return (
    <form
      method="POST"
      action={verComoBarberiaAction(barbershopId)}
      target="_blank"
      onSubmit={() => setEntrando(true)}
      // En la lista la fila entera abre la ficha: el clic del botón no es de la fila.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ display: "inline" }}
    >
      <ButtonNew
        size={size}
        variant="primary"
        type="submit"
        disabled={entrando}
        icon={<Eye size={size === "sm" ? 13 : 14} />}
      >
        {entrando ? "Entrando…" : etiqueta}
      </ButtonNew>
    </form>
  );
}
