import { Ban, Check, Clock, Lock, ShieldCheck, TriangleAlert } from "lucide-react";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * TRES PANTALLAS DEL PRODUCTO, DIBUJADAS EN HTML Y CSS.
 *
 * Ni capturas ni ilustraciones de banco: marcado normal con las clases de
 * esta hoja. Pesa nada, se ve nítido en cualquier densidad de píxeles y se
 * adapta al ancho como todo lo demás.
 *
 * Lo que enseñan es lo que el panel hace de verdad —la nota que ya no se
 * edita, la firma que se vence cuando se toca lo firmado, la lista de
 * precios que resuelve el servidor—; los nombres y los folios son de
 * ejemplo y no hay ninguna cifra de dinero: en la pantalla real el importe
 * lo pone el servidor, y en una página pública no va.
 *
 * Para el lector de pantalla cada tarjeta es UNA imagen con su etiqueta
 * (`role="img"` + `aria-label`) y su contenido va `aria-hidden`: lo que
 * cuentan ya está escrito en la prosa que las rodea.
 * ═══════════════════════════════════════════════════════════════════════
 */

function Ventana({
  titulo,
  chip,
  chipTono,
  children,
  aria,
  className,
}: {
  titulo: string;
  chip?: string;
  chipTono?: "ok" | "espera" | "alto";
  children: React.ReactNode;
  aria: string;
  className?: string;
}) {
  return (
    <figure
      className={`dcei-mock${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={aria}
    >
      <div className="dcei-mock__in" aria-hidden="true">
        <header className="dcei-mock__head">
          <span className="dcei-mock__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="dcei-mock__title">{titulo}</span>
          {chip ? (
            <span className={`dcei-chip dcei-chip--${chipTono ?? "ok"}`}>
              {chipTono === "espera" ? <Clock size={12} /> : null}
              {chipTono === "alto" ? <TriangleAlert size={12} /> : null}
              {(chipTono ?? "ok") === "ok" ? <Check size={12} /> : null}
              {chip}
            </span>
          ) : null}
        </header>
        <div className="dcei-mock__body">{children}</div>
      </div>
    </figure>
  );
}

/** 1 · La nota clínica que ya no se puede editar. */
export function MockNotaFirmada() {
  return (
    <Ventana
      titulo="Nota clínica · Endodoncia"
      chip="Firmada"
      aria="Una nota clínica firmada dentro del expediente: sus cuatro apartados, el sello de firma con fecha y el aviso de que ya no se puede editar."
    >
      <dl className="dcei-soap">
        <div>
          <dt>Subjetivo</dt>
          <dd>Dolor a la percusión en 46 desde hace cuatro días. Sin fiebre.</dd>
        </div>
        <div>
          <dt>Objetivo</dt>
          <dd>Caries oclusodistal profunda. Prueba térmica prolongada. Zona periapical sin lesión visible.</dd>
        </div>
        <div>
          <dt>Análisis</dt>
          <dd>Pulpitis irreversible sintomática en 46.</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>Tratamiento de conductos en dos sesiones. Control radiográfico al terminar.</dd>
        </div>
      </dl>
      <p className="dcei-mock__sello">
        <Lock size={13} />
        <span>
          <strong>Firmada por la Dra. Carmen Villalobos</strong> · 12 mar 2026, 14:08
        </span>
      </p>
      <p className="dcei-mock__pie">
        <Ban size={12} /> Ya no se edita. Si algo estaba mal, se corrige con una nota nueva que apunta
        a ésta.
      </p>
    </Ventana>
  );
}

/** 2 · La puerta de autorización, con sus tres estados. */
export function MockAutorizacion() {
  return (
    <Ventana
      titulo="Autorización · Plan de tratamiento"
      aria="La bandeja de autorizaciones del docente, con una solicitud pendiente, una autorizada y otra vencida porque se editó lo que ya estaba firmado."
    >
      <ul className="dcei-gate">
        <li>
          <span className="dcei-gate__quien">
            <strong>Sofía Ibarra</strong> · A-014 · Endodoncia
          </span>
          <span className="dcei-chip dcei-chip--espera">
            <Clock size={12} /> Pendiente
          </span>
        </li>
        <li>
          <span className="dcei-gate__quien">
            <strong>Rodrigo Peña</strong> · A-027 · Periodoncia
          </span>
          <span className="dcei-chip dcei-chip--ok">
            <ShieldCheck size={12} /> Autorizada
          </span>
        </li>
        <li>
          <span className="dcei-gate__quien">
            <strong>Ana Lucía Márquez</strong> · A-031 · Prótesis
          </span>
          <span className="dcei-chip dcei-chip--alto">
            <TriangleAlert size={12} /> Vencida
          </span>
        </li>
      </ul>
      <p className="dcei-mock__nota">
        La tercera se venció sola: se editó lo que el docente ya había firmado, así que hay que
        mandarla otra vez.
      </p>
      <p className="dcei-mock__pie">
        <Lock size={12} /> Sin la firma del plan, el caso no pasa a «en tratamiento».
      </p>
    </Ventana>
  );
}

/** 3 · La tarifa que resuelve el servidor, en el mostrador. */
export function MockTarifa() {
  return (
    <Ventana
      titulo="Caja · Cobro nuevo"
      aria="La pantalla de caja resolviendo qué lista de precios le toca al paciente y por qué, con las líneas del cobro y el aviso de que el importe lo pone el servidor."
    >
      <p className="dcei-caja__paciente">
        <strong>Martín Aguilar Rosas</strong> · Expediente 0412
      </p>
      <div className="dcei-caja__tarifa">
        <span className="dcei-chip dcei-chip--marca">Lista aplicada · Pacientes de estudiante</span>
        <p>Lo trajo la estudiante Sofía Ibarra (A-014).</p>
      </div>
      <ul className="dcei-caja__lineas">
        <li>
          <span>Endodoncia unirradicular</span>
          <span className="dcei-caja__importe">
            <Lock size={11} /> del servidor
          </span>
        </li>
        <li>
          <span>Radiografía periapical · 2</span>
          <span className="dcei-caja__importe">
            <Lock size={11} /> del servidor
          </span>
        </li>
      </ul>
      <p className="dcei-mock__pie">
        <Check size={12} /> En caja nadie teclea importes. Si el navegador manda uno, se descarta y
        queda registrado.
      </p>
    </Ventana>
  );
}
