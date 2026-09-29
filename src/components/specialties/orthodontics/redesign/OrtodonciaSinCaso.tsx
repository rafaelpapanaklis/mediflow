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
import { useEffect, useState } from "react";
import { Check, Smile } from "lucide-react";
import { BotonAbrirCaso } from "./BotonAbrirCaso";
import { DrawerNewCase, type DrawerNewCaseSubmit } from "./drawers/DrawerNewCase";
import { RAIZ_ORTO } from "./raiz";
import { CasosMigrados, useCasosMigrados } from "./CasosMigrados";
import { etiquetaAbrirCaso, pistaSinCaso, tituloSinCaso, TITULO_CASO_ABIERTO, PISTA_CASO_ABIERTO } from "./casos-migrados-texto";
import { useAbrirAltaAlLlegar } from "./useAbrirAltaAlLlegar";
import orto from "./orto.module.css";

export interface OrtodonciaSinCasoProps {
  patientId: string;
  patientFullName: string;
  /** `true` = el caso quedó abierto (la ficha se está refrescando); `false`/nada = no. */
  onCreateCase: (payload: DrawerNewCaseSubmit) => Promise<boolean | void> | boolean | void;
  /**
   * Se llegó desde «Nueva consulta», eligiendo el tipo «Ortodoncia»: no hay
   * caso en el que registrar un control, así que se explica y se OFRECE
   * abrirlo (no se abre solo: quien eligió «Ortodoncia» quería una consulta,
   * no necesariamente un caso).
   */
  vieneDeNuevaConsulta?: boolean;
  onAvisoAtendido?: () => void;
}

export function OrtodonciaSinCaso({
  patientId,
  patientFullName,
  onCreateCase,
  vieneDeNuevaConsulta,
  onAvisoAtendido,
}: OrtodonciaSinCasoProps) {
  const [altaAbierta, setAltaAbierta] = useState(false);
  // ws1-t10 (D): el caso ya se abrió pero la ficha refrescada tarda en llegar (~9 s en dev): mientras
  // tanto no se sigue diciendo «no tiene caso». Al llegar la ficha, esta vista se desmonta sola.
  const [casoAbierto, setCasoAbierto] = useState(false);
  // Casos anteriores migrados del sistema de origen: cambian el título («Sin caso activo · tiene N…») y el botón.
  const migrados = useCasosMigrados(patientId);
  const nMigrados = migrados?.length ?? 0;
  useAbrirAltaAlLlegar({ tieneCaso: false, puedeCrear: true, abrir: () => setAltaAbierta(true) });

  // El aviso se recuerda aquí y se apaga en la ficha, para que al volver a la
  // pestaña otro día no salga otra vez.
  const [desdeConsulta, setDesdeConsulta] = useState(false);
  useEffect(() => {
    if (!vieneDeNuevaConsulta) return;
    setDesdeConsulta(true);
    onAvisoAtendido?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vieneDeNuevaConsulta]);

  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
      <section className={orto.tarjeta} aria-labelledby="orto-sin-caso-titulo">
        <div className={`${orto.vacio} ${orto.vacioSinCaso}`}>
          <span className={orto.vacioIcono} aria-hidden>
            {casoAbierto ? <Check size={18} strokeWidth={1.75} /> : <Smile size={18} strokeWidth={1.75} />}
          </span>
          <h2 id="orto-sin-caso-titulo" className={orto.vacioTitulo} role={casoAbierto ? "status" : undefined}>
            {casoAbierto ? TITULO_CASO_ABIERTO : tituloSinCaso(patientFullName, nMigrados)}
          </h2>
          <p className={orto.vacioPista}>{casoAbierto ? PISTA_CASO_ABIERTO : pistaSinCaso(nMigrados, desdeConsulta)}</p>
          {casoAbierto ? null : (
            <BotonAbrirCaso
              className="mt-2"
              etiqueta={etiquetaAbrirCaso(nMigrados)}
              onClick={() => setAltaAbierta(true)}
            />
          )}
        </div>
      </section>
      <CasosMigrados patientId={patientId} casosDados={migrados} />

      {altaAbierta ? (
        <DrawerNewCase
          patientId={patientId}
          patientFullName={patientFullName}
          existingDiagnosisId={null}
          onClose={() => setAltaAbierta(false)}
          onConfirm={async (payload) => {
            const abierto = await onCreateCase(payload);
            if (abierto === true) setCasoAbierto(true);
            setAltaAbierta(false);
          }}
        />
      ) : null}
    </div>
  );
}
