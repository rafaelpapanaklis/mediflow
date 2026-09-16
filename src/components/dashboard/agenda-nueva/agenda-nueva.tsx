"use client";

/**
 * La agenda nueva de Claude Design — el armazón.
 *
 * Barra de herramientas arriba (64 px, común a las tres vistas), la vista
 * debajo, y a la derecha uno de los dos paneles: el de la cita o el de buscar
 * hueco. Nunca los dos: abrir uno cierra el otro.
 *
 * ⛔ SOLO se monta con el interruptor `menu-dos-niveles` encendido para la
 * clínica. Con la bandera apagada, `AgendaPageClient` renderiza el `AgendaShell`
 * de siempre y de aquí no se monta ni un nodo: las dos agendas no comparten
 * árbol, así que la de siempre no puede cambiar ni un píxel por culpa de ésta.
 *
 * Los DATOS son los de siempre: este armazón vive DENTRO del `AgendaProvider`
 * que ya existe, así que las citas, los doctores, las unidades, el refetch con
 * caché, las actualizaciones optimistas y el rollback son los mismos que usa
 * la agenda actual. Aquí no hay ni un `useReducer` nuevo.
 */

import type { Role } from "@prisma/client";
import { instrumentSans } from "@/fonts/menu";
import { BarraHerramientas } from "./barra-herramientas";
import { AgendaNuevaProvider, useAgendaNueva } from "./contexto-agenda-nueva";
import { PanelCita } from "./panel-cita";
import { PanelHuecos } from "./panel-huecos";
import { VistaDia } from "./vista-dia";
import { VistaSemana } from "./vista-semana";
import { VistaMes } from "./vista-mes";
import s from "./agenda-nueva.module.css";

export interface AgendaNuevaProps {
  /**
   * `Clinic.cfdiTaxMode` ("exempt" | "iva16"), ya resuelto en el servidor.
   * Baja hasta el cobro del panel: sin él, el CFDI se timbraría EXENTO en una
   * clínica con IVA, y eso sería una diferencia FISCAL causada por la bandera.
   */
  clinicTaxMode: string | null;
  /** El rol de quien mira, para no ofrecer transiciones que su rol no permite. */
  userRole?: Role;
}

export function AgendaNueva(props: AgendaNuevaProps) {
  return (
    <AgendaNuevaProvider>
      <Armazon {...props} />
    </AgendaNuevaProvider>
  );
}

function Armazon({ clinicTaxMode, userRole }: AgendaNuevaProps) {
  const ag = useAgendaNueva();

  return (
    <div className={`${s.raiz} ${instrumentSans.variable}`}>
      <BarraHerramientas />

      <div className={s.cuerpo}>
        <div className={s.zonaAgenda}>
          {/* ── Las tres vistas ──
              Día es de ws1-t1; Semana y Mes, de ws1-t2. Las tres comparten la
              misma `Cuadricula`, la misma `TarjetaCita`, los mismos tokens y
              el mismo `useAgendaNueva()`: no hay una rejilla por vista. */}
          {ag.vista === "dia" && <VistaDia />}
          {ag.vista === "semana" && <VistaSemana />}
          {ag.vista === "mes" && <VistaMes />}
        </div>

        {ag.panel === "cita" && <PanelCita clinicTaxMode={clinicTaxMode} userRole={userRole} />}
        {ag.panel === "huecos" && <PanelHuecos />}
      </div>
    </div>
  );
}
