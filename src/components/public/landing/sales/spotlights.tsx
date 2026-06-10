import { CalendarDays, Sparkles, Receipt, Building2, Check, Lock, ArrowRight } from "lucide-react";
import { AgendaMock, XrayMock, BillingMock, ClinicMock, WhatsAppMini } from "./mockups";

/* Marco de ventana para los mockups de spotlight. */
function Win({ children, url = "app.dalecontrol.mx" }: { children: React.ReactNode; url?: string }) {
  return (
    <div className="mfh-win">
      <div className="mfh-win__bar">
        <div className="mfh-win__dots">
          <i style={{ background: "#ff5f57" }} />
          <i style={{ background: "#febc2e" }} />
          <i style={{ background: "#28c840" }} />
        </div>
        <div className="mfh-win__url"><Lock /> {url}</div>
      </div>
      <div className="mfh-win__screen">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mfh-spot__list">
      {items.map((b) => (
        <li key={b} className="mfh-spot__li"><Check /> {b}</li>
      ))}
    </ul>
  );
}

export function Spotlights() {
  return (
    <section className="mfh-section mfh-band" aria-label="Funciones a detalle">
      <div className="mfh-container">

        {/* 1 · Agenda + WhatsApp */}
        <div className="mfh-spot mfh-reveal">
          <div className="mfh-spot__copy">
            <span className="mfh-spot__tag"><CalendarDays /> Agenda inteligente</span>
            <h2 className="mfh-h2 mfh-balance">Llena tu agenda y olvida las faltas</h2>
            <p className="mfh-lede">
              Sincroniza con Google Calendar y deja que DaleControl recuerde y confirme cada cita
              por WhatsApp. Tus pacientes confirman con un mensaje; tú llenas los huecos.
            </p>
            <Bullets items={[
              "Recordatorios y confirmaciones automáticas por WhatsApp",
              "Sincronización en dos vías con Google Calendar",
              "Vista por día, semana y mes con código de color por estado",
              "Reagenda en segundos arrastrando la cita",
            ]} />
            <a href="#precios" className="mfh-btn mfh-btn--soft" style={{ alignSelf: "flex-start" }}>
              Ver Planes <ArrowRight />
            </a>
          </div>
          <div className="mfh-spot__media">
            <Win url="app.dalecontrol.mx/agenda"><AgendaMock /></Win>
            <div style={{ marginTop: 14, maxWidth: 340, marginLeft: "auto" }}>
              <WhatsAppMini />
            </div>
          </div>
        </div>

        {/* 2 · Radiografías con IA */}
        <div className="mfh-spot mfh-spot--rev mfh-reveal">
          <div className="mfh-spot__copy">
            <span className="mfh-spot__tag"><Sparkles /> Radiografías con IA</span>
            <h2 className="mfh-h2 mfh-balance">Un segundo par de ojos en cada placa</h2>
            <p className="mfh-lede">
              Sube la radiografía y la IA resalta hallazgos sobre la imagen: caries, lesiones
              periapicales y pérdida ósea, cada uno con su nivel de confianza y severidad.
            </p>
            <Bullets items={[
              "Detección de caries, lesiones y pérdida ósea",
              "Recuadros sobre la placa con severidad por color",
              "Nivel de confianza por hallazgo para tu criterio clínico",
              "Comparación entre estudios y medición de distancias",
            ]} />
            <a href="#precios" className="mfh-btn mfh-btn--soft" style={{ alignSelf: "flex-start" }}>
              Ver Planes <ArrowRight />
            </a>
          </div>
          <div className="mfh-spot__media">
            <Win url="app.dalecontrol.mx/radiografias"><XrayMock /></Win>
          </div>
        </div>

        {/* 3 · Facturación CFDI 4.0 */}
        <div className="mfh-spot mfh-reveal">
          <div className="mfh-spot__copy">
            <span className="mfh-spot__tag"><Receipt /> Facturación CFDI 4.0</span>
            <h2 className="mfh-h2 mfh-balance">Cobra y timbra ante el SAT sin salir del panel</h2>
            <p className="mfh-lede">
              Genera y timbra facturas CFDI 4.0 válidas en segundos, ligadas al cobro y al
              expediente. Controla lo cobrado, lo pendiente y lo timbrado de un vistazo.
            </p>
            <Bullets items={[
              "Timbrado CFDI 4.0 válido ante el SAT",
              "RFC, uso de CFDI y método de pago precargados",
              "Tablero de cobrado, por cobrar y vencido",
              "Cumple NOM-024 con datos cifrados",
            ]} />
            <a href="#precios" className="mfh-btn mfh-btn--soft" style={{ alignSelf: "flex-start" }}>
              Ver Planes <ArrowRight />
            </a>
          </div>
          <div className="mfh-spot__media">
            <Win url="app.dalecontrol.mx/facturacion"><BillingMock /></Win>
          </div>
        </div>

        {/* 4 · Mi Clínica Visual */}
        <div className="mfh-spot mfh-spot--rev mfh-reveal">
          <div className="mfh-spot__copy">
            <span className="mfh-spot__tag"><Building2 /> Mi Clínica Visual</span>
            <h2 className="mfh-h2 mfh-balance">Tu consultorio, en un mapa vivo</h2>
            <p className="mfh-lede">
              Dibuja tu clínica en un editor 2.5D y mira la ocupación en tiempo real: qué
              sillón está libre, quién sigue y dónde está cada paciente.
            </p>
            <Bullets items={[
              "Editor 2.5D con sillones, recepción y salas",
              "Ocupación de consultorios en vivo",
              "Modo edición y modo en vivo",
              "Pantalla ideal para sala de espera",
            ]} />
            <a href="#precios" className="mfh-btn mfh-btn--soft" style={{ alignSelf: "flex-start" }}>
              Ver Planes <ArrowRight />
            </a>
          </div>
          <div className="mfh-spot__media">
            <Win url="app.dalecontrol.mx/mi-clinica"><ClinicMock /></Win>
          </div>
        </div>

      </div>
    </section>
  );
}
