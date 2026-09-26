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
 *
 * Ajuste 2: el teléfono es el mismo modelo que el de «WhatsApp + Mercado
 * Pago» (`.dcv4-phone`, whatsapp-phone.tsx) a escala 2/3, con su barra de
 * estado y su barra de inicio; las medidas están en todo-el-panel.css.
 */
export function PortalPacienteMock() {
  return (
    <div className="dctp-phone">
      <span className="dctp-phone__isla" />
      <div className="dctp-portal">
        {/* Barra de estado: la misma que el teléfono de WhatsApp (whatsapp-phone.tsx). */}
        <div className="dctp-portal__status">
          <span>9:41</span>
          <span className="dctp-portal__statusr">
            <svg width="12" height="9" viewBox="0 0 14 10" fill="currentColor" aria-hidden="true"><rect x="0" y="6" width="2.4" height="4" rx=".6" /><rect x="3.8" y="4" width="2.4" height="6" rx=".6" /><rect x="7.6" y="2" width="2.4" height="8" rx=".6" /><rect x="11.4" y="0" width="2.4" height="10" rx=".6" /></svg>
            <svg width="19" height="9" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x=".6" y=".6" width="18" height="8.8" rx="2.2" /><rect x="2.2" y="2.2" width="14" height="5.6" rx="1" fill="currentColor" stroke="none" /><rect x="19.6" y="3.2" width="1.8" height="3.6" rx=".6" fill="currentColor" stroke="none" /></svg>
          </span>
        </div>
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
                <b>Jue 26 · 10:30</b>
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
        <div className="dctp-portal__home"><i /></div>
      </div>
    </div>
  );
}
