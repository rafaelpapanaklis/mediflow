"use client";
// La pestaña «Ortodoncia» para quien tiene la llave del módulo pero NO el
// expediente (recepción, solo lectura): X2 / MAPA 19. Lo clínico del caso
// (diagnóstico, plan clínico, hojas, fotos, cefalometría) ni se carga en el
// servidor para esta persona; aquí solo se le explica y se le lleva a lo que sí
// le toca — las citas y el cobro, que viven en sus pestañas de la ficha.
// La regla de cuándo toca esta vista: `vistaOrtoPorPermisos` en
// src/lib/orthodontics/pestana-ficha.ts.
import { CalendarDays, Lock, Wallet } from "lucide-react";
import { Btn } from "./atoms/Btn";
import { NotasInternas } from "./NotasInternas";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { bloquesDeNotas, fechaCortaDeCaso } from "./notas-internas-casos";
import { RAIZ_ORTO } from "./raiz";
import orto from "./orto.module.css";

export interface OrtodonciaAdministrativaProps {
  onVerCitas: () => void;
  /** `null` si la persona no puede ver la facturación: el botón no sale. */
  onVerCobro: (() => void) | null;
  /**
   * El caso más reciente del paciente. Las «Notas internas» NO son un dato clínico (son de trato: «pidió que lo atienda
   * el doctor X»): las ven todos los que tienen acceso al paciente, recepción incluida (decisión de Rafael, ws1-t6).
   */
  casoId?: string | null;
  /**
   * Todos los casos vivos del paciente (el más reciente primero). Si hay más de uno, recepción ve las notas de cada
   * uno, con el caso al que pertenecen (ws1-t8 · N-P5). Tiene prioridad sobre `casoId`.
   */
  casos?: Array<{ id: string; abierto: string }>;
  /** Zona horaria de la CLÍNICA, para la fecha de cada caso (ws1-t8 · N3-P4). */
  zonaHoraria?: string | null;
  soloLectura?: boolean;
}

export function OrtodonciaAdministrativa({ onVerCitas, onVerCobro, casoId = null, casos, zonaHoraria = null, soloLectura = false }: OrtodonciaAdministrativaProps) {
  const t = useT();
  const locale = useLocale();
  const bloques = bloquesDeNotas(casos, casoId, (abierto) =>
    t("ortoNotasInternas.casoAbierto", { fecha: fechaCortaDeCaso(abierto, locale, zonaHoraria) }),
  );
  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
      <section className={orto.tarjeta} aria-labelledby="orto-administrativa-titulo">
        <div className={`${orto.vacio} ${orto.vacioSinCaso}`}>
          <span className={orto.vacioIcono} aria-hidden>
            <Lock size={18} strokeWidth={1.75} />
          </span>
          <h2 id="orto-administrativa-titulo" className={orto.vacioTitulo}>
            Lo clínico del caso lo ven doctores
          </h2>
          <p className={orto.vacioPista}>
            El diagnóstico, el plan clínico, las hojas de control, las fotos y la cefalometría
            necesitan el permiso de expediente clínico. Las citas y el cobro de ortodoncia
            están en sus pestañas de la ficha.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Btn
              variant="secondary"
              icon={<CalendarDays size={16} strokeWidth={1.75} aria-hidden />}
              onClick={onVerCitas}
            >
              Ver citas
            </Btn>
            {onVerCobro ? (
              <Btn
                variant="secondary"
                icon={<Wallet size={16} strokeWidth={1.75} aria-hidden />}
                onClick={onVerCobro}
              >
                Ver cobro
              </Btn>
            ) : null}
          </div>
        </div>
      </section>
      {bloques.map((b) => (
        <NotasInternas key={b.caseId ?? "sin-caso"} caseId={b.caseId} soloLectura={soloLectura} etiquetaCaso={b.etiquetaCaso} />
      ))}
    </div>
  );
}

