/**
 * Arnés de `clics-chromium.test.ts`: la pantalla REAL del odontograma del
 * Instituto (EduOdontogramaScreen, la de /instituto/pacientes/[id]/odontograma)
 * con la sesión de una docente. Lo empaqueta esbuild y lo abre Chromium.
 *
 * Lo que en la página llega del servidor (las filas vivas) se pide aquí a la
 * ruta REAL `GET /api/instituto/pacientes/[id]/odontograma`; así «recargar»
 * vuelve a leer lo que de verdad se guardó. `?lectura` = sin odontograma.edit.
 */
import { createRoot } from "react-dom/client";
import { EduOdontogramaScreen } from "@/components/edu/expediente/odontograma-screen";
import type { EduOdontogramEntryRow } from "@/lib/edu/odontograma-core";

const lectura = new URLSearchParams(window.location.search).has("lectura");

void fetch("/api/instituto/pacientes/pat_1/odontograma", { cache: "no-store" })
  .then((r) => r.json() as Promise<{ rows: EduOdontogramEntryRow[] }>)
  .then(({ rows }) => {
    createRoot(document.getElementById("root")!).render(
      <div className="edu-shell">
        <EduOdontogramaScreen
          patientId="pat_1"
          entries={rows}
          historial={rows}
          historialTruncado={false}
          movimientos={[]}
          movimientosTruncados={false}
          denticionInicial="permanent"
          esInfantil={false}
          canEdit={!lectura}
        />
      </div>,
    );
  });
