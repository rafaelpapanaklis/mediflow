"use client";

// «Ver como clínica» (auditoría 30-sep-2026, M5; un clic desde ws1-t11, 2-oct):
// un formulario POST de un solo botón —sin ventana ni motivo, pedido de Rafael—
// que abre el panel de la clínica en una PESTAÑA NUEVA (decisión de Rafael):
// /admin se queda donde estaba. La sesión dura 2 h y se registra solo en la
// bitácora de admin (admin_impersonation_sessions); la barra «Estás viendo
// como…» del panel la cierra con «Salir y volver a /admin».

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

export function BotonVerComoClinica({
  clinicId,
  etiqueta = "Ver como clínica",
  size,
}: {
  clinicId: string;
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
    <form method="POST" action="/api/admin/impersonate" target="_blank" onSubmit={() => setEntrando(true)} style={{ display: "inline" }}>
      <input type="hidden" name="clinicId" value={clinicId} />
      <ButtonNew size={size} variant="primary" type="submit" disabled={entrando} icon={<Eye size={size === "sm" ? 13 : 14} />}>
        {entrando ? "Entrando…" : etiqueta}
      </ButtonNew>
    </form>
  );
}
