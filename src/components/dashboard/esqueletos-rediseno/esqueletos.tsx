import type { CSSProperties, ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./esqueletos.module.css";

/**
 * Los esqueletos de carga del rediseño (ws1-t3, hallazgo 19): la FORMA de
 * cada pantalla nueva, en gris, para que lo que llega después caiga encima
 * sin saltar. Sin hooks, para que un `loading.tsx` (servidor) los monte tal
 * cual. Los colores, el radio y la letra vienen de `CLASES_MENU`
 * (menu-dos-niveles/clases.ts): aquí no hay un solo color escrito.
 *
 * Solo se montan con la bandera `menu-dos-niveles` encendida
 * (`segun-bandera.tsx`). Apagada, cada pantalla enseña su esqueleto de siempre.
 */

const cx = (...clases: Array<string | false | undefined>) => clases.filter(Boolean).join(" ");

function Hueso({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cx(s.hueso, className)} style={style} aria-hidden />;
}

function Raiz({ children, className, style, etiqueta }: { children: ReactNode; className?: string; style?: CSSProperties; etiqueta: string }) {
  return (
    <div className={cx(CLASES_MENU, s.raiz, s.contenedor, className)} style={style} aria-busy="true" aria-label={etiqueta}>
      {children}
    </div>
  );
}

/** Cabecera de pantalla: título, subtítulo y botones a la derecha. */
function Cabecera({ botones = 2, anchoTitulo = 220 }: { botones?: number; anchoTitulo?: number }) {
  return (
    <div className={s.cabecera}>
      <div>
        <Hueso className={s.huesoTitulo} style={{ width: anchoTitulo }} />
        <Hueso className={s.huesoSub} style={{ width: anchoTitulo * 1.3 }} />
      </div>
      {botones > 0 && (
        <div className={s.acciones}>
          {Array.from({ length: botones }).map((_, i) => (
            <Hueso key={i} className={s.huesoBoton} style={{ width: i === 0 ? 128 : 112 }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi() {
  return (
    <div className={s.kpi}>
      <Hueso className={s.huesoTexto} style={{ width: "55%" }} />
      <Hueso className={s.huesoCifra} style={{ width: "45%" }} />
    </div>
  );
}

function TarjetaCabeza({ accion }: { accion?: boolean }) {
  return (
    <div className={s.tarjetaCabeza}>
      <Hueso className={s.huesoIcono} />
      <div className={s.tarjetaTextos}>
        <Hueso className={s.huesoTexto} style={{ width: 140, height: 14 }} />
        <Hueso className={s.huesoTextoChico} style={{ width: 96 }} />
      </div>
      {accion && <Hueso className={s.huesoTextoChico} style={{ width: 110 }} />}
    </div>
  );
}

function Fila({ ancho = "52%" }: { ancho?: string }) {
  return (
    <div className={s.fila}>
      <Hueso className={s.huesoTextoChico} style={{ width: 38 }} />
      <div className={s.filaCuerpo}>
        <Hueso className={s.huesoTexto} style={{ width: ancho }} />
        <Hueso className={s.huesoTextoChico} style={{ width: "36%" }} />
      </div>
      <Hueso className={s.huesoBotonChico} style={{ width: 72, height: 28 }} />
    </div>
  );
}

const ANCHOS = ["58%", "44%", "62%", "50%", "40%", "55%", "47%", "60%", "42%", "53%"];

/**
 * «Hoy» y, por herencia, toda pantalla de /dashboard sin loading.tsx propio:
 * cabecera, cuatro KPIs y la rejilla 2/3 + 1/3 de tarjetas con filas.
 */
export function EsqueletoHoy() {
  return (
    <Raiz etiqueta="Cargando el panel" style={{ maxWidth: 1240, margin: "0 auto", padding: "clamp(14px, 2vw, 24px) 0" }}>
      <Cabecera />
      <div className={s.kpis}>
        {[0, 1, 2, 3].map((i) => <Kpi key={i} />)}
      </div>
      <div className={s.rejillaPrincipal}>
        <section className={s.tarjeta}>
          <TarjetaCabeza accion />
          <div className={s.tarjetaLista}>
            {ANCHOS.slice(0, 5).map((a, i) => <Fila key={i} ancho={a} />)}
          </div>
        </section>
        <section className={s.tarjeta}>
          <TarjetaCabeza />
          <div className={s.tarjetaLista}>
            {ANCHOS.slice(5, 9).map((a, i) => <Fila key={i} ancho={a} />)}
          </div>
        </section>
      </div>
    </Raiz>
  );
}

/**
 * La agenda nueva: barra de 64 px (Día/Semana/Mes, flechas y «Hoy», título,
 * «Nueva cita»), cabecera de columnas con el avatar de cada doctor y la
 * cuadrícula de horas con algunas citas.
 */
export function EsqueletoAgenda() {
  const citas: Array<[number, number, number]> = [
    [0, 64, 112], [0, 256, 64], [1, 128, 96], [1, 320, 128], [2, 96, 64], [2, 224, 112],
  ];
  return (
    <Raiz etiqueta="Cargando la agenda" className={s.agenda}>
      <div className={s.agendaBarra}>
        <div className={s.agendaSegmentado}>
          {[0, 1, 2].map((i) => <Hueso key={i} className={s.agendaSegmento} />)}
        </div>
        <div className={s.agendaNav}>
          <Hueso className={s.agendaNavBoton} />
          <Hueso className={s.huesoBotonChico} style={{ width: 52, height: 32 }} />
          <Hueso className={s.agendaNavBoton} />
        </div>
        <Hueso className={s.huesoTitulo} style={{ width: 200, height: 18 }} />
        <div className={s.agendaEspaciador} />
        <Hueso className={s.huesoBotonChico} style={{ width: 120, height: 34 }} />
        <span className={cx(s.hueso, s.agendaCta)} aria-hidden />
      </div>
      <div className={s.agendaCuerpo}>
        <div className={s.agendaEncabezado}>
          <div className={s.agendaEsquina} />
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.agendaColumnaCabeza}>
              <Hueso className={s.huesoCirculo} style={{ width: 32, height: 32 }} />
              <div className={s.filaCuerpo}>
                <Hueso className={s.huesoTexto} style={{ width: "60%" }} />
                <Hueso className={s.huesoTextoChico} style={{ width: "40%" }} />
              </div>
            </div>
          ))}
        </div>
        <div className={s.agendaLienzo}>
          <div className={s.agendaEje}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className={s.agendaHora}>
                <Hueso className={s.huesoTextoChico} style={{ width: 34 }} />
              </div>
            ))}
          </div>
          {[0, 1, 2].map((col) => (
            <div key={col} className={s.agendaColumna}>
              {citas.filter((c) => c[0] === col).map(([, top, alto], i) => (
                <Hueso key={i} className={s.agendaCita} style={{ top, height: alto }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Raiz>
  );
}

/**
 * Listas: Pacientes (pastillas de filtro + buscador + tabla con avatar),
 * Inventario (KPIs + buscador y segmentos + tabla) y Caja (segmentos + KPIs
 * + tabla). Misma tarjeta de tabla, distinto encabezado.
 */
export function EsqueletoLista({ variante, filas = 8 }: { variante: "pacientes" | "inventario" | "caja"; filas?: number }) {
  const conAvatar = variante === "pacientes";
  const etiqueta = variante === "pacientes" ? "Cargando pacientes" : variante === "inventario" ? "Cargando el inventario" : "Cargando la caja";
  return (
    <Raiz etiqueta={etiqueta} style={{ maxWidth: 1400, margin: "0 auto", padding: variante === "pacientes" ? 0 : "clamp(14px, 1.6vw, 28px)" }}>
      <Cabecera botones={variante === "caja" ? 0 : 2} />

      {variante === "pacientes" && (
        <div className={s.pastillas}>
          {[72, 88, 80].map((w, i) => <Hueso key={i} className={s.huesoPastilla} style={{ width: w }} />)}
          <span className={s.pastillaDivisor} aria-hidden />
          {[96, 84, 104].map((w, i) => <Hueso key={i} className={s.huesoPastilla} style={{ width: w }} />)}
        </div>
      )}

      {variante === "caja" && (
        <div className={s.barraHerramientas}>
          <div className={s.segmentado}>
            {[0, 1].map((i) => <Hueso key={i} className={s.segmento} />)}
          </div>
        </div>
      )}

      {(variante === "inventario" || variante === "caja") && (
        <div className={cx(s.kpis, s.kpisAuto)}>
          {[0, 1, 2, 3].map((i) => <Kpi key={i} />)}
        </div>
      )}

      {variante !== "caja" && (
        <div className={s.barraHerramientas}>
          <Hueso className={s.huesoCampo} style={{ maxWidth: variante === "pacientes" ? 360 : 300 }} />
          {variante === "inventario" ? (
            <div className={s.segmentado}>
              {[0, 1, 2].map((i) => <Hueso key={i} className={s.segmento} style={{ width: 72 }} />)}
            </div>
          ) : (
            <>
              <Hueso className={s.huesoBoton} style={{ width: 96 }} />
              <Hueso className={s.huesoBoton} style={{ width: 88 }} />
            </>
          )}
        </div>
      )}

      <section className={cx(s.tarjeta, s.tarjetaAncha)}>
        <div className={s.tablaCabeza}>
          {conAvatar && <Hueso className={s.huesoTextoChico} style={{ width: 16, height: 16, borderRadius: 4 }} />}
          <Hueso className={s.huesoTextoChico} style={{ width: "22%" }} />
          <Hueso className={s.huesoTextoChico} style={{ width: "14%" }} />
          <Hueso className={s.huesoTextoChico} style={{ width: "12%" }} />
          <span style={{ flex: 1 }} />
          <Hueso className={s.huesoTextoChico} style={{ width: 64 }} />
        </div>
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className={s.tablaFila}>
            {conAvatar && <Hueso className={s.huesoTextoChico} style={{ width: 16, height: 16, borderRadius: 4 }} />}
            {conAvatar && <Hueso className={s.huesoCirculo} style={{ width: 32, height: 32 }} />}
            <div className={s.tablaCelda}>
              <Hueso className={s.huesoTexto} style={{ width: ANCHOS[i % ANCHOS.length] }} />
              <Hueso className={s.huesoTextoChico} style={{ width: "32%" }} />
            </div>
            <Hueso className={s.huesoTextoChico} style={{ width: 72 }} />
            <Hueso className={s.huesoPastilla} style={{ width: 84, height: 24 }} />
            <Hueso className={s.huesoBotonChico} style={{ width: 36, height: 30 }} />
          </div>
        ))}
      </section>
    </Raiz>
  );
}

/**
 * El expediente del paciente con el rediseño: migas → cabecera única
 * (avatar, identidad, métricas, acciones, chips) → barra HORIZONTAL de
 * secciones (sustituye al menú lateral) → el contenido, a todo lo ancho
 * (en Resumen no hay carril derecho).
 */
export function EsqueletoExpediente() {
  return (
    <Raiz etiqueta="Cargando expediente del paciente" className={s.expediente}>
      <div className={s.migas}>
        <Hueso className={s.huesoTextoChico} style={{ width: 72 }} />
        <Hueso className={s.huesoTextoChico} style={{ width: 8 }} />
        <Hueso className={s.huesoTextoChico} style={{ width: 160 }} />
      </div>

      <section className={cx(s.tarjeta, s.tarjetaAncha)}>
        <div className={s.fichaCabecera}>
          <Hueso className={s.fichaAvatar} />
          <div className={s.fichaIdentidad}>
            <Hueso className={s.huesoTitulo} style={{ width: 240, maxWidth: "100%" }} />
            <Hueso className={s.huesoTexto} style={{ width: 300, maxWidth: "100%" }} />
          </div>
          <div className={s.fichaMetricas}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={s.fichaMetrica}>
                <Hueso className={s.huesoTextoChico} style={{ width: 56 }} />
                <Hueso className={s.huesoTexto} style={{ width: 48, height: 18 }} />
              </div>
            ))}
          </div>
          <div className={s.acciones}>
            <Hueso className={s.huesoBoton} style={{ width: 132 }} />
            <Hueso className={s.huesoBoton} style={{ width: 96 }} />
          </div>
        </div>
        <div className={s.fichaChips}>
          {[96, 112, 88, 104].map((w, i) => <Hueso key={i} className={s.huesoPastilla} style={{ width: w, height: 24 }} />)}
        </div>
      </section>

      <nav className={s.fichaMenu} aria-hidden>
        {[0, 1, 2].map((i) => <Hueso key={i} className={s.fichaMenuItem} style={{ width: 96 }} />)}
        <span className={s.fichaMenuSeparador} />
        {[0, 1, 2, 3, 4].map((i) => <Hueso key={i} className={s.fichaMenuItem} />)}
      </nav>

      <section className={cx(s.tarjeta, s.tarjetaAncha)}>
        <TarjetaCabeza />
        <div className={s.tarjetaCuerpo}>
          <div className={s.kpis}>
            {[0, 1, 2, 3].map((i) => <Kpi key={i} />)}
          </div>
        </div>
      </section>
      <section className={cx(s.tarjeta, s.tarjetaAncha)}>
        <TarjetaCabeza accion />
        <div className={s.tarjetaLista}>
          {ANCHOS.slice(0, 4).map((a, i) => <Fila key={i} ancho={a} />)}
        </div>
      </section>
    </Raiz>
  );
}

/**
 * Equipo: cabecera, fila de KPIs, filtro segmentado y la rejilla de
 * tarjetas de miembro (avatar, nombre, rol, dos datos y dos botones). Misma
 * geometría que el esqueleto de siempre, con la ropa del menú nuevo.
 */
export function EsqueletoEquipo() {
  return (
    <Raiz etiqueta="Cargando el equipo" className={s.equipo}>
      <Cabecera botones={1} anchoTitulo={168} />
      <div className={s.equipoKpis}>
        {[0, 1, 2, 3].map((i) => <Kpi key={i} />)}
      </div>
      <div className={s.barraHerramientas}>
        <div className={s.segmentado}>
          {[0, 1, 2].map((i) => <Hueso key={i} className={s.segmento} style={{ width: 76 }} />)}
        </div>
      </div>
      <div className={s.equipoRejilla}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <section key={i} className={cx(s.tarjeta, s.tarjetaAncha, s.miembro)}>
            <Hueso className={s.huesoCirculo} style={{ width: 64, height: 64 }} />
            <Hueso className={s.huesoTexto} style={{ width: 140, height: 15, marginTop: 4 }} />
            <Hueso className={s.huesoTextoChico} style={{ width: 184 }} />
            <Hueso className={s.huesoPastilla} style={{ width: 88, height: 20, marginTop: 6 }} />
            <div className={s.miembroDatos}>
              <Hueso style={{ height: 30 }} />
              <Hueso style={{ height: 30 }} />
            </div>
            <div className={s.acciones} style={{ marginTop: 14 }}>
              <Hueso className={s.huesoBotonChico} style={{ width: 74 }} />
              <Hueso className={s.huesoBotonChico} style={{ width: 96 }} />
            </div>
          </section>
        ))}
      </div>
    </Raiz>
  );
}

/**
 * Cuenta suspendida / activación: píldora + título + texto centrados, el
 * conmutador mensual/anual, las TRES tarjetas de plan y el bloque de pago.
 */
export function EsqueletoCuenta() {
  return (
    <Raiz etiqueta="Cargando la cuenta" className={s.cuenta}>
      <div className={s.cuentaCabecera}>
        <Hueso className={s.huesoPastilla} style={{ width: 190, height: 34 }} />
        <Hueso className={s.huesoTitulo} style={{ width: "min(420px, 90%)", height: 34 }} />
        <Hueso className={s.huesoTexto} style={{ width: "min(560px, 95%)", height: 16 }} />
      </div>
      <div className={s.cuentaCiclo}>
        <Hueso className={s.huesoPastilla} style={{ width: 260, height: 44 }} />
        <Hueso className={s.huesoPastilla} style={{ width: 120, height: 24 }} />
      </div>
      <div className={s.cuentaPlanes}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.plan}>
            <Hueso className={s.huesoPastilla} style={{ width: 92, height: 22 }} />
            <Hueso className={s.huesoTexto} style={{ width: "50%", height: 20 }} />
            <Hueso className={s.huesoCifra} style={{ width: "66%", height: 34 }} />
            <span className={s.planSeparador} aria-hidden />
            {[0, 1, 2, 3, 4].map((f) => <Hueso key={f} className={s.huesoTexto} style={{ width: "100%", height: 15 }} />)}
          </div>
        ))}
      </div>
      <section className={cx(s.tarjeta, s.tarjetaAncha, s.cuentaPago)}>
        <Hueso style={{ height: 52, width: "100%", borderRadius: 13 }} />
        <Hueso style={{ height: 52, width: "100%", borderRadius: 13 }} />
        <Hueso className={s.huesoTexto} style={{ width: 200, height: 16 }} />
      </section>
    </Raiz>
  );
}
