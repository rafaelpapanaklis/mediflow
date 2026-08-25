"use client";

/* ═══════════════════════════════════════════════════════════════════════
   PLAN BÁSICO: PÁGINA SÍ, EDITOR NO.

   Esta pantalla existe porque "no tienes acceso" habría sido mentira. En
   Básico la barbería SÍ tiene página web —con la plantilla Clásica, sus
   servicios de verdad, sus barberos de verdad y su botón de reservar—, lo
   que no tiene es el editor.

   Así que aquí no se enseña un candado: se enseña SU página, tal como se
   ve ahora mismo, con su liga y su QR listos para pegar en Instagram y en
   la puerta. Lo que se ofrece al subir de plan es cambiarla, no tenerla.

   El candado de verdad NO está aquí: está en el servidor, en la página
   (/barber/mi-web) y en la API (/api/barber/landing). Esta pantalla solo
   cuenta lo que pasa.
   ═══════════════════════════════════════════════════════════════════════ */

import { useMemo } from "react";
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import type { BarberWebData } from "@/components/barber/templates/types";
import { Compartir } from "./compartir";
import { VistaPrevia } from "./vista-previa";
import type { TFn } from "./controles";
import "./editor.css";

export function UpsellWebBarberia({
  dict,
  data,
  urlPublica,
}: {
  dict: Dictionary;
  data: BarberWebData;
  urlPublica: string;
}) {
  const t = useMemo<TFn>(() => {
    const tt = makeBarberT(dict);
    return (k, vars) => tt(`barber.web.${k}`, vars);
  }, [dict]);

  return (
    <div className="dcbwe">
      <header className="dcbwe-cab">
        <div>
          <h1>{t("titulo")}</h1>
          <p className="dcbwe-ayuda">{t("upsellTitulo")}</p>
        </div>
      </header>

      <div className="dcbwe-upsell">
        <div className="dcbwe-upsell-txt">
          <h2>{t("upsellTitulo")}</h2>
          <p>{t("upsellCuerpo")}</p>
          {/* Enlace del panel al panel: <a> y no <Link>, como el resto del
              vertical, para no arrastrar el router del cliente a una
              pantalla que es casi estática. */}
          <a href="/barber/suscripcion" className="dcbwe-btn dcbwe-btn-primario">
            {t("upsellBoton")}
          </a>
          <Compartir t={t} url={urlPublica} slug={data.shop.slug} />
        </div>

        <div className="dcbwe-previa">
          <span className="dcbwe-etiqueta">{t("upsellTuPagina")}</span>
          <VistaPrevia data={data} modo="movil" t={t} />
        </div>
      </div>
    </div>
  );
}
