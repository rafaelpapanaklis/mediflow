import { BrandGlyph } from "@/components/public/landing/primitives/logo";
import { inter } from "@/fonts/inter-400-800";
import "./pantalla.css";

/**
 * Lo que se VE en /onboarding mientras el servidor termina de crear la
 * clínica: navy y trama de puntos de la portada, tarjeta blanca, anillo
 * girando (quieto con reduced-motion) y los tres pasos que están pasando.
 * Sin datos ni lógica: page.tsx sigue decidiendo sesión y redirecciones, y
 * sólo monta esto. Al no depender de nada, una vista previa local puede
 * pintarlo con las mismas props (ninguna).
 */
export function PantallaOnboarding() {
  return (
    <div className={`dcob ${inter.variable}`}>
      <div className="dcob__dots" aria-hidden="true" />
      <div className="dcob__card" role="status" aria-live="polite">
        <div className="dcob__logo" aria-hidden="true">
          <span className="dcob__ring" />
          <span className="dcob__tile">
            <BrandGlyph size={30} mono="#fff" />
          </span>
        </div>
        <h1 className="dcob__title">Estamos preparando tu clínica…</h1>
        <p className="dcob__text">Unos segundos y te llevamos a tu panel.</p>
        <ol className="dcob__pasos" aria-hidden="true">
          <li className="dcob__paso is-done">Cuenta creada</li>
          <li className="dcob__paso is-on">Configurando tu espacio</li>
          <li className="dcob__paso">Abriendo tu panel</li>
        </ol>
        <p className="dcob__help">
          Si esto tarda más de 30 segundos,{" "}
          <a href="/login" className="dcob__link">
            vuelve a iniciar sesión
          </a>
          .
        </p>
      </div>
    </div>
  );
}
