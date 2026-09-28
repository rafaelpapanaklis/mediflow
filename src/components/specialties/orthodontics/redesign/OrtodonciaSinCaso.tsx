"use client";
// La pestaña «Ortodoncia» de un paciente que NUNCA ha tenido caso (decisión de
// Rafael, 28-sep-2026): vino a limpieza o a revisión, y la sede tiene el
// módulo. La pestaña sale, pero solo para abrir un caso: una vista limpia, sin
// las secciones del expediente de ortodoncia en blanco (plan, controles,
// fotos, cobro, retención…), que antes salían todas vacías.
//
// El botón abre el asistente de alta de siempre (`DrawerNewCase`); al guardar,
// la ficha se refresca y la pestaña pasa a ser la completa. La regla de cuándo
// toca esta vista vive en `src/lib/orthodontics/pestana-ficha.ts`.
import { useState } from "react";
import { FolderPlus, Smile } from "lucide-react";
import { Btn } from "./atoms/Btn";
import {
  DrawerNewCase,
  type DrawerNewCaseDiagnosisPayload,
  type DrawerNewCasePlanPayload,
} from "./drawers/DrawerNewCase";
import { RAIZ_ORTO } from "./raiz";
import { useAbrirAltaAlLlegar } from "./useAbrirAltaAlLlegar";
import orto from "./orto.module.css";

export interface OrtodonciaSinCasoProps {
  patientId: string;
  patientFullName: string;
  onCreateCase: (payload: {
    diagnosis: DrawerNewCaseDiagnosisPayload | null;
    plan: DrawerNewCasePlanPayload | null;
  }) => Promise<void> | void;
}

export function OrtodonciaSinCaso({ patientId, patientFullName, onCreateCase }: OrtodonciaSinCasoProps) {
  const [altaAbierta, setAltaAbierta] = useState(false);
  useAbrirAltaAlLlegar({ tieneCaso: false, puedeCrear: true, abrir: () => setAltaAbierta(true) });

  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
      <section className={orto.tarjeta} aria-labelledby="orto-sin-caso-titulo">
        <div className={`${orto.vacio} ${orto.vacioSinCaso}`}>
          <span className={orto.vacioIcono} aria-hidden>
            <Smile size={18} strokeWidth={1.75} />
          </span>
          <h2 id="orto-sin-caso-titulo" className={orto.vacioTitulo}>
            {patientFullName} no tiene caso de ortodoncia
          </h2>
          <p className={orto.vacioPista}>
            Al abrirlo se registran el diagnóstico y el plan de tratamiento. Después aparecen aquí sus controles, sus fotos,
            el cobro y la retención.
          </p>
          <Btn
            variant="primary"
            size="lg"
            className="mt-1"
            icon={<FolderPlus size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => setAltaAbierta(true)}
          >
            Abrir caso de ortodoncia
          </Btn>
        </div>
      </section>

      {altaAbierta ? (
        <DrawerNewCase
          patientId={patientId}
          patientFullName={patientFullName}
          existingDiagnosisId={null}
          onClose={() => setAltaAbierta(false)}
          onConfirm={async (payload) => {
            await onCreateCase(payload);
            setAltaAbierta(false);
          }}
        />
      ) : null}
    </div>
  );
}
