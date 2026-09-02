import {
  eduAlmNivel,
  eduAlmPorcentaje,
  eduAlmPrecioLabel,
  eduAlmRestanteBytes,
  eduAlmTexto,
  EDU_ALM_NOTA_ALCANCE,
  EDU_ALM_UMBRAL_AVISO,
  EDU_ALM_UMBRAL_CRITICO,
  type EduAlmMedidor,
} from "@/lib/edu/almacenamiento-core";
import { eduFormatBytes } from "@/lib/edu/estudios-core";

/**
 * EL MEDIDOR DE ALMACENAMIENTO del instituto, en el tablero de dirección.
 *
 * Componente de SERVIDOR: no tiene un solo estado ni un solo evento, así
 * que no hay razón para mandarle JavaScript al navegador. Todo lo que
 * decide —el color, el porcentaje, las palabras— sale de funciones puras de
 * almacenamiento-core.ts, que es donde están sus pruebas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SE VE Y NO SE EDITA. No hay botón, y no es que falte: la cuota es una
 * CLÁUSULA DEL CONTRATO. Se cambia desde el /admin de DaleControl o por
 * SQL. Si la escuela pudiera subírsela sola, el cobro por TB extra no
 * existiría — es la misma línea que ya trazó la Ola 8 con lo que incluye el
 * contrato de IA.
 *
 * 🔴 Y NO LO VE NADIE MÁS. Un ALUMNO, un DOCENTE y CAJA no llegan aquí: lo
 * decide el punto único de alcance (eduPuedeVerAlmacenamiento, en
 * visibility.ts) y lo aplica la página, que ni siquiera pide los datos.
 *
 * La barra NO es decorativa: verde hasta el 80 %, ámbar al 80, roja al 95 y
 * al 100 la tarjeta deja de ser un medidor y pasa a ser un aviso de que la
 * subida está detenida, con qué hacer al respecto.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduAlmacenamientoCard({ medidor }: { medidor: EduAlmMedidor }) {
  const nivel = eduAlmNivel(medidor);
  const pct = eduAlmPorcentaje(medidor);
  const texto = eduAlmTexto(medidor);
  const restante = eduAlmRestanteBytes(medidor);

  // La barra reusa .edu-progreso de la Ola 6. Los modificadores de color
  // son propios (--aviso / --critico); el rojo del 100 % es el
  // .edu-progreso--agotado que ya existía para el cupo de IA agotado: es
  // exactamente el mismo significado, "esto ya no funciona".
  const barra =
    nivel === "lleno"
      ? "edu-progreso--agotado"
      : nivel === "critico"
        ? "edu-progreso--critico"
        : nivel === "aviso"
          ? "edu-progreso--aviso"
          : "";

  return (
    <section className={`edu-req edu-alm edu-alm--${nivel}`} aria-labelledby="edu-alm-titulo">
      <div className="edu-req__head">
        <span className="edu-req__name" id="edu-alm-titulo">
          Almacenamiento del instituto
        </span>
        <span className="edu-req__num">
          {eduFormatBytes(medidor.usadoBytes)} de {eduFormatBytes(medidor.cuotaBytes)}
        </span>
      </div>

      <div className={`edu-progreso ${barra}`} aria-hidden>
        <span className="edu-progreso__bar" style={{ width: `${pct}%` }} />
      </div>

      <p className="edu-req__detail">
        <strong>{texto.titulo}.</strong> {texto.detalle}
      </p>

      <div className="edu-kv">
        <span className="edu-kv__k">Incluye el contrato</span>
        <span className="edu-kv__v">
          {eduFormatBytes(medidor.cuotaBytes)} para TODO el instituto, con sus sedes dentro. Las
          sedes son ilimitadas y comparten esta misma bolsa: tres campus con {" "}
          {eduFormatBytes(medidor.cuotaBytes)} son {eduFormatBytes(medidor.cuotaBytes)} entre los
          tres.
        </span>

        <span className="edu-kv__k">Usado</span>
        <span className="edu-kv__v">
          {eduFormatBytes(medidor.usadoBytes)} en {medidor.estudios.toLocaleString("es-MX")}{" "}
          {medidor.estudios === 1 ? "estudio" : "estudios"} ({pct} %). {EDU_ALM_NOTA_ALCANCE}
        </span>

        <span className="edu-kv__k">Queda</span>
        <span className="edu-kv__v">
          {restante > 0
            ? `${eduFormatBytes(restante)}. Al ${EDU_ALM_UMBRAL_AVISO} % esta tarjeta avisa, al ${EDU_ALM_UMBRAL_CRITICO} % se pone en rojo y al 100 % la subida se detiene.`
            : "Nada. La subida de estudios está detenida hasta que se contrate más espacio o se libere el que hay."}
        </span>

        <span className="edu-kv__k">Más espacio</span>
        <span className="edu-kv__v">
          Se contrata con DaleControl: {eduAlmPrecioLabel()}. No se edita desde el panel — es una
          cláusula del contrato, como las fechas de vigencia.
        </span>
      </div>
    </section>
  );
}
