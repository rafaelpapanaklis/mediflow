"use client";

import { useState } from "react";
import { ChevronDown, FileDown, History, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import s from "./rediseno.module.css";

/**
 * Historia clínica, rediseñada.
 *
 * Lo que había: dos cajas grises pegadas sin jerarquía —la línea de tiempo y,
 * debajo, la bitácora de accesos que exige la NOM-024— con el título de la
 * pantalla a la izquierda y una frase suelta a la derecha, a la misma altura
 * y del mismo tamaño.
 *
 * Lo que hay ahora: un encabezado de pantalla de verdad (qué es esto y para
 * qué sirve), la línea de tiempo respirando en su tarjeta, y la bitácora
 * PLEGADA. La bitácora es un requisito legal, no lectura diaria: quien la
 * necesita la abre; quien viene a ver al paciente ya no tiene que pasar por
 * encima de ella.
 *
 * El contenido es el mismo de siempre: esta pantalla no toca ni la línea de
 * tiempo ni la bitácora, solo las coloca.
 */
export function Historia({
  timeline,
  bitacora,
  onExportarCda,
}: {
  timeline: React.ReactNode;
  bitacora: React.ReactNode;
  onExportarCda?: () => void;
}) {
  const t = useT();
  const [bitacoraAbierta, setBitacoraAbierta] = useState(false);

  return (
    <div className={s.columna}>
      <header className={s.pantallaCabeza}>
        <div>
          <h1 className={s.pantallaTitulo}>{t("patients.history.title")}</h1>
          <p className={s.pantallaSub}>{t("pacientesRediseno.historia.subtitulo")}</p>
        </div>
        {onExportarCda && (
          <div className={s.pantallaAcciones}>
            <button type="button" className={s.boton} onClick={onExportarCda}>
              <FileDown size={14} strokeWidth={1.75} aria-hidden />
              {t("patients.export.cdaLabel")}
            </button>
          </div>
        )}
      </header>

      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.tarjetaIcono}>
            <History size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.tarjetaTitulo}>{t("pacientesRediseno.historia.movimientos")}</h2>
        </header>
        <div className={s.tarjetaCuerpo}>{timeline}</div>
      </section>

      <section className={`${s.tarjeta} ${s.bitacoraCaja}`}>
        <button
          type="button"
          className={s.bitacoraCabeza}
          onClick={() => setBitacoraAbierta((v) => !v)}
          aria-expanded={bitacoraAbierta}
        >
          <span className={s.tarjetaIcono}>
            <ShieldCheck size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <span className={s.tarjetaTitulo}>{t("pacientesRediseno.historia.bitacora")}</span>
          <span className={s.pantallaSub} style={{ margin: 0 }}>
            {t("pacientesRediseno.historia.bitacoraPista")}
          </span>
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden
            style={{
              marginLeft: 8,
              flexShrink: 0,
              transform: bitacoraAbierta ? "rotate(180deg)" : undefined,
              transition: "transform .15s",
            }}
          />
        </button>
        {bitacoraAbierta && <div className={s.bitacoraCuerpo}>{bitacora}</div>}
      </section>
    </div>
  );
}
