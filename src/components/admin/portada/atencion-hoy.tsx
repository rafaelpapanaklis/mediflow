// Server component a propósito: no hay estado ni handlers, así que no lleva
// "use client". Recibe la portada YA construida (módulo puro `atencion-core`)
// y solo la pinta; aquí no se decide quién está vencida ni cuánto se debe.
import Link from "next/link";
import {
  AlertOctagon, AlertTriangle, AlertCircle, CreditCard, Activity,
  Hourglass, PowerOff, UserX, HelpCircle, CheckCircle2, FlaskConical, Archive,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PuntoEnLinea } from "./actividad-panel";
import type { GrupoAtencion, MotivoAtencion, Portada, SeveridadAtencion } from "./atencion-core";
import { DIAS_ACTIVIDAD, DIAS_APAGADA, DIAS_SIN_LOGIN, DIAS_TRIAL_POR_VENCER } from "./atencion-core";
import "./portada.css";

/** Cuántas clínicas se listan por tarjeta antes del «y N más». */
const FILAS_VISIBLES = 4;

/**
 * Tres canales para la misma información, porque el color solo no basta:
 *  1. color  → --danger / --warning / --info
 *  2. forma  → la barra izquierda de .pa-grupo (sólida / rayada / punteada)
 *             y un icono de silueta distinta (octágono / triángulo / círculo)
 *  3. palabra→ CRÍTICO / ALTO / MEDIO, escrito
 */
const SEVERIDAD: Record<SeveridadAtencion, { palabra: string; icono: LucideIcon }> = {
  critico: { palabra: "Crítico", icono: AlertOctagon },
  alto:    { palabra: "Alto",    icono: AlertTriangle },
  medio:   { palabra: "Medio",   icono: AlertCircle },
};

/** Icono propio de cada motivo: se distingue el grupo de un vistazo. */
const ICONO_MOTIVO: Record<MotivoAtencion, LucideIcon> = {
  cobro_fallido:      CreditCard,
  usando_sin_plan:    Activity,
  trial_por_vencer:   Hourglass,
  apagada:            PowerOff,
  sin_login:          UserX,
  estado_desconocido: HelpCircle,
};

function Grupo({ grupo }: { grupo: GrupoAtencion }) {
  const sev = SEVERIDAD[grupo.severidad];
  const Icono = ICONO_MOTIVO[grupo.motivo];
  const visibles = grupo.senales.slice(0, FILAS_VISIBLES);
  const ocultas = grupo.senales.length - visibles.length;

  return (
    <section className={`pa-grupo pa-grupo--${grupo.severidad}`} aria-label={`${grupo.titulo} — severidad ${sev.palabra}`}>
      <header className="pa-grupo__head">
        <span className="pa-grupo__icon" aria-hidden>
          <Icono size={15} strokeWidth={2} />
        </span>
        <span className="pa-grupo__titles">
          <span className="pa-grupo__title">{grupo.titulo}</span>
          <span className="pa-grupo__criterio">{grupo.criterio}</span>
        </span>
        <span className="pa-grupo__count">
          <span className="pa-grupo__n">{grupo.senales.length}</span>
          {/* La silueta del icono + la palabra: el mismo dato sin depender del color. */}
          <span className="pa-grupo__sev">
            <sev.icono size={9} strokeWidth={2.5} aria-hidden style={{ verticalAlign: "-1px", marginRight: 3 }} />
            {sev.palabra}
          </span>
        </span>
      </header>

      <ul className="pa-lista">
        {visibles.map((s) => {
          // El importe manda sobre el dato descriptivo: si esta clínica debe
          // dinero, lo primero que se lee a la derecha es cuánto.
          const dinero = s.montoEnRiesgo > 0;
          const derecha = dinero ? formatCurrency(s.montoEnRiesgo) : s.dato;
          return (
            <li key={s.clave} className="pa-fila">
              <Link href={`/admin/clinics/${s.clinicaId}`} className="pa-fila__link">
                <span className="pa-fila__texto">
                  <span className="pa-fila__nombre">
                    {/* El nombre va en su propio span: el CSS recorta con
                        puntos suspensivos el PRIMER hijo, y un nodo de texto
                        suelto no es un elemento al que se pueda apuntar. */}
                    <span>{s.clinicaNombre}</span>
                    {/* Está dentro del panel ahora: sirve para saber si llamar
                        ya o esperar. Discreto, no compite con la alarma. */}
                    {s.clinicaEnLinea && <PuntoEnLinea />}
                  </span>
                  <span className="pa-fila__porque">{s.porQue}</span>
                </span>
                {/* Sin dato NO se inventa nada: se dice que no está. */}
                <span className={`pa-fila__dato${dinero ? " pa-fila__dato--dinero" : ""}`}>
                  {derecha ?? "sin dato"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {ocultas > 0 && (
        <div className="pa-grupo__mas">y {ocultas} más</div>
      )}
    </section>
  );
}

/**
 * «Qué exige atención hoy» — lo PRIMERO que se lee en /admin.
 *
 * `avisos` son problemas al MEDIR (una consulta que falló), no problemas de
 * las clínicas: se enseñan aparte para que nadie confunda «no hay nada» con
 * «no se pudo mirar».
 */
export function AtencionHoy({
  portada,
  dineroSinCobrar,
  avisos = [],
}: {
  portada: Portada;
  /**
   * El MISMO valor que el KPI «por cobrar» de más abajo, tal cual, sin
   * recalcular. Dos cifras de dinero en la misma pantalla con rótulos casi
   * iguales tienen que ser el mismo número o no ponerse: `dineroEnRiesgo` es
   * solo la parte atribuible a un cobro roto, y se enseña como matiz.
   */
  dineroSinCobrar: number;
  avisos?: string[];
}) {
  const { grupos, totales, cuentasDePrueba, archivadas } = portada;
  const hayCritico = grupos.some((g) => g.severidad === "critico");
  const nadaQueAtender = grupos.length === 0;

  return (
    <>
      {nadaQueAtender ? (
        // Sin señales la sección lo DICE, y dice contra qué se comprobó: un
        // hueco mudo se lee igual que una consulta que no corrió.
        <div className="pa-vacio">
          <CheckCircle2 size={22} strokeWidth={2} className="pa-vacio__icon" aria-hidden />
          <div>
            <p className="pa-vacio__title">Nada exige atención hoy</p>
            <p className="pa-vacio__body">
              Se revisaron <span className="pa-num">{totales.reales}</span>{" "}
              {totales.reales === 1 ? "clínica" : "clínicas"} y ninguna disparó una señal. Lo que se miró:
            </p>
            <ul className="pa-vacio__lista">
              <li>cobros rechazados por Stripe y suscripciones en reintentos</li>
              <li>planes vencidos con citas en los últimos {DIAS_ACTIVIDAD} días</li>
              <li>trials que vencen dentro de {DIAS_TRIAL_POR_VENCER} días</li>
              <li>clínicas sin una sola cita desde hace {DIAS_APAGADA} días o más</li>
              <li>suscripciones vivas y trials vigentes sin login en {DIAS_SIN_LOGIN} días</li>
              <li>filas sin <code className="mono">subscriptionStatus</code></li>
            </ul>
          </div>
        </div>
      ) : (
        <div className={`pa-resumen ${hayCritico ? "pa-resumen--alerta" : "pa-resumen--limpio"}`}>
          <span className="pa-resumen__icon" aria-hidden>
            {hayCritico
              ? <AlertOctagon size={18} strokeWidth={2} />
              : <AlertTriangle size={18} strokeWidth={2} />}
          </span>
          <div className="pa-resumen__main">
            <p className="pa-resumen__titular">
              <span className="pa-num">{totales.conSenal}</span> de{" "}
              <span className="pa-num">{totales.reales}</span>{" "}
              {totales.reales === 1 ? "clínica exige" : "clínicas exigen"} atención hoy
            </p>
            <p className="pa-resumen__detalle">
              <span className="pa-num">{totales.senales}</span>{" "}
              {totales.senales === 1 ? "señal" : "señales"} en {grupos.length}{" "}
              {grupos.length === 1 ? "motivo" : "motivos"}
              {hayCritico ? " · hay al menos un motivo crítico" : " · nada crítico"}
            </p>
          </div>
          {dineroSinCobrar > 0 && (
            <div className="pa-resumen__dinero">
              <div className="pa-resumen__dinero-label">Dinero sin cobrar</div>
              <div className="pa-resumen__dinero-valor">{formatCurrency(dineroSinCobrar)}</div>
              {/* Cuando no todo el pendiente viene de un cobro roto, se dice
                  cuánto sí. Si coinciden, la aclaración sobra y no se pinta. */}
              {totales.dineroEnRiesgo > 0 && totales.dineroEnRiesgo !== dineroSinCobrar && (
                <div className="pa-resumen__dinero-nota">
                  {formatCurrency(totales.dineroEnRiesgo)} por cobro fallido
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {grupos.length > 0 && (
        <div className="pa-grid">
          {grupos.map((g) => <Grupo key={g.motivo} grupo={g} />)}
        </div>
      )}

      {/* Lo apartado se NOMBRA. No se borra, no se toca y no se esconde: solo
          deja de contar en las señales de arriba, y aquí se dice cuántas son. */}
      {cuentasDePrueba.length > 0 && (
        <div className="pa-nota">
          <FlaskConical size={14} className="pa-nota__icon" aria-hidden />
          <div>
            <strong className="pa-num">{cuentasDePrueba.length}</strong>{" "}
            {cuentasDePrueba.length === 1 ? "cuenta apartada" : "cuentas apartadas"} de los conteos de esta
            sección por estar vacías: 0 pacientes, 0 citas, nunca pagaron y no deben nada
            {" — "}
            {cuentasDePrueba.map((c) => c.nombre).join(", ")}.
            {" "}Siguen en la base y en los totales de más abajo; nadie las ha borrado.
          </div>
        </div>
      )}

      {archivadas.length > 0 && (
        <div className="pa-nota">
          <Archive size={14} className="pa-nota__icon" aria-hidden />
          <div>
            <strong className="pa-num">{archivadas.length}</strong>{" "}
            {archivadas.length === 1 ? "clínica archivada" : "clínicas archivadas"} fuera de esta sección:
            se apagaron a propósito, así que no son una alarma
            {" — "}
            {archivadas.map((c) => c.nombre).join(", ")}.
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="pa-nota">
          <AlertTriangle size={14} className="pa-nota__icon" aria-hidden />
          <div>
            <strong>No se pudo medir todo.</strong>{" "}
            {avisos.join(" ")} Las señales que dependen de ese dato pueden faltar.
          </div>
        </div>
      )}
    </>
  );
}

/** Separador entre «atención hoy» y los indicadores de siempre. */
export function SeparadorIndicadores({ children }: { children: React.ReactNode }) {
  return (
    <div className="pa-sep">
      <span className="pa-sep__label">{children}</span>
      <span className="pa-sep__line" aria-hidden />
    </div>
  );
}
