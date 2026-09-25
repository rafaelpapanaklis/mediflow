import { BrandGlyph } from "../../primitives/logo";
import { IconoPanel } from "./icono-panel";

/**
 * EL PORTAL DEL PACIENTE, reconstruido en código (como hizo t1 con el marco
 * del panel). Réplica del inicio real del portal —`src/app/paciente/(panel)/
 * page.tsx` + `portal-shell.tsx` + `ui.tsx`—: fondo #0b0815, tarjetas #121020
 * con borde rgba(255,255,255,.08) y radio 14, acento violeta #7c3aed/#a78bfa,
 * IBM Plex Sans (la `--font-sans` del layout raíz), barra superior del móvil
 * con el glifo de la marca y «Portal del paciente», «Hola, {nombre}», «Próximas
 * citas» con su badge «Confirmada» (#34d399), «Saldo pendiente» y los accesos
 * rápidos (Citas · Agendar · Historial · Pagos).
 *
 * Por qué en código y no grabado: entrar al portal exige una cuenta de
 * paciente y, si no está verificada, un código por correo, y el prompt
 * prohíbe mandarlo. Decorativo: va dentro de un contenedor `aria-hidden`.
 */
export function PortalPacienteMock() {
  return (
    <div className="dctp-phone">
      <span className="dctp-phone__isla" />
      <div className="dctp-portal">
        <div className="dctp-portal__top">
          <span className="dctp-portal__logo"><BrandGlyph size={13} mono="#ffffff" /></span>
          <span className="dctp-portal__brand">
            <b>DaleControl</b>
            <i>Portal del paciente</i>
          </span>
          <span className="dctp-portal__bell"><IconoPanel nombre="chat" size={15} /><em /></span>
        </div>
        <div className="dctp-portal__body">
          <span className="dctp-portal__hola">Hola, Ana</span>
          <span className="dctp-portal__sub">Este es el resumen de tu salud</span>

          <div className="dctp-portal__card">
            <span className="dctp-portal__h2">Próximas citas</span>
            <span className="dctp-portal__cita">
              <span className="dctp-portal__citatx">
                <b>Jue 26 sep · 10:30</b>
                <i>Dra. Ruiz · Limpieza</i>
              </span>
              <span className="dctp-portal__badge">Confirmada</span>
            </span>
          </div>

          <div className="dctp-portal__card">
            <span className="dctp-portal__h2">Saldo pendiente</span>
            <span className="dctp-portal__saldo">$1,200.00</span>
            <span className="dctp-portal__pagar"><IconoPanel nombre="credit_card" size={14} /> Pagar en línea</span>
          </div>

          <div className="dctp-portal__card">
            <span className="dctp-portal__h2">Accesos rápidos</span>
            <span className="dctp-portal__quick">
              <span><IconoPanel nombre="calendar_month" size={18} /> Citas</span>
              <span><IconoPanel nombre="add" size={18} /> Agendar</span>
              <span><IconoPanel nombre="assignment" size={18} /> Historial</span>
              <span><IconoPanel nombre="credit_card" size={18} /> Pagos</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
