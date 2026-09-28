"use client";

// Ortodoncia — expediente en solo lectura (ws1-t10, decisión 3): con el módulo
// vencido el caso se LEE, y los botones que escriben no hacen nada. El servidor
// ya rechaza cualquier escritura sin módulo activo; esto solo evita dejar
// botones vivos que van a fallar. Se monta ALREDEDOR de la pestaña para no
// tocar su archivo (varias pantallas lo editan a la vez).

import type { ReactNode } from "react";
import toast from "react-hot-toast";
import { esAccionDeEscritura } from "@/lib/orthodontics/pestana-ficha";

export function SoloLectura({ activo, children }: { activo: boolean; children: ReactNode }) {
  if (!activo) return <>{children}</>;
  return (
    <div
      data-solo-lectura
      onClickCapture={(e) => {
        const boton = (e.target as HTMLElement).closest("button, [role='button']");
        if (!boton) return;
        const etiqueta = `${boton.textContent ?? ""} ${boton.getAttribute("aria-label") ?? ""}`;
        if (!esAccionDeEscritura(etiqueta)) return;
        e.preventDefault();
        e.stopPropagation();
        toast("Solo lectura: el módulo de Ortodoncia no está activo en esta sede.", { id: "orto-solo-lectura" });
      }}
    >
      {children}
    </div>
  );
}
