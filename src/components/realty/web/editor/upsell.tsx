"use client";

/* ═══════════════════════════════════════════════════════════════════════
   LA WEB QUE YA TIENES, SIN EDITOR.

   El plan PROPIETARIO incluye la web pública con la plantilla por defecto;
   lo que no incluye es el EDITOR visual. Decir "no tienes acceso" sería
   mentira: la página existe, está publicada y se puede compartir. Lo que
   se ofrece al subir de plan es CAMBIARLA, no tenerla.

   Por eso esta pantalla enseña SU página de verdad, con su liga y su QR, y
   el botón lleva a la suscripción. Un candado gris con un candado dibujado
   habría sido más fácil y más falso.
   ═══════════════════════════════════════════════════════════════════════ */

import type { RealtyWebData } from "@/lib/realty/landing";
import { VistaPrevia } from "@/components/realty/web/editor/vista-previa";
import { Compartir } from "@/components/realty/web/editor/compartir";
import "@/components/realty/web/editor/editor.css";

export function UpsellWebInmuebles({
  data,
  urlPublica,
  nombrePlan,
}: {
  data: RealtyWebData;
  urlPublica: string;
  nombrePlan: string;
}) {
  return (
    <div className="dcrwe">
      <header className="dcrwe-cabeza">
        <div>
          <h1 className="dcrwe-titulo">Mi web</h1>
          <p className="dcrwe-sub">
            Tu web ya está publicada con la plantilla que le toca a tu tipo de cuenta.
          </p>
        </div>
        <div className="dcrwe-cabeza-acciones">
          <a
            className="dcrwe-btn dcrwe-btn-sutil"
            href={urlPublica}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver mi web
          </a>
          <a className="dcrwe-btn dcrwe-btn-primario" href="/inmobiliaria/suscripcion">
            Ver planes
          </a>
        </div>
      </header>

      {/* Sin nombrar qué plan trae el editor: eso vive en la tabla
          realty_plan_configs y se edita sin redeploy, así que cualquier
          nombre escrito aquí caduca solo. */}
      <p className="dcrwe-aviso">
        El plan {nombrePlan} incluye tu web pública, tus inmuebles y el formulario que cae en tus
        prospectos. El editor visual —cambiar la plantilla, los textos, el color y el orden de las
        secciones— viene con un plan superior.
      </p>

      <div className="dcrwe-cuerpo">
        <div className="dcrwe-controles">
          <Compartir url={urlPublica} nombre={data.cuenta.nombre} />
        </div>
        <div className="dcrwe-lienzo">
          <div className="dcrwe-lienzo-barra">
            <span className="dcrwe-ruta">Así se ve hoy</span>
          </div>
          <VistaPrevia data={{ ...data, editando: false }} modo="escritorio" />
        </div>
      </div>
    </div>
  );
}
