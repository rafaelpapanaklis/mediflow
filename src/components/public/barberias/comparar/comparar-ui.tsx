// ═══════════════════════════════════════════════════════════════════════
// Piezas de las páginas públicas de COMPARATIVA.
//
// TODO es componente de SERVIDOR: cero "use client", cero estado. Una
// comparativa es texto y una tabla; meterle JavaScript sólo le quitaría
// velocidad a una página cuyo único trabajo es cargar rápido y posicionar.
// Por eso `t` viaja como prop: entre componentes de servidor no hay
// frontera de serialización.
//
// 🔴 REGLA QUE SOSTIENE ESTE ARCHIVO: cada afirmación sobre un competidor
// se pinta CON su fuente. Los reportes de usuarios pasan siempre por
// <Reportes>, que los enmarca como "usuarios reportan en <fuente>" y nunca
// como hecho. No hay ruta para pintar un dato sin fuente.
// ═══════════════════════════════════════════════════════════════════════
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  ExternalLink,
  Info,
  MessageSquare,
  Scissors,
} from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { BarberResolvedPlan } from "@/lib/barber/plan-shared";
import {
  EJES,
  REVISADO_EL,
  REVISADO_EL_TEXTO,
  escenarios,
  fuente,
  nuestroEje,
  type Competidor,
  type Fuente,
} from "@/lib/barber/comparativas";

export const RUTA_REGISTRO = "/barber/registro";
export const RUTA_INDICE = "/barberias/comparar";
export const RUTA_LANDING = "/barberias";

// ── Armazón: tema caramelo + barra + pie ────────────────────────────────

export function CompararShell({
  t,
  children,
}: {
  t: TFunction;
  children: React.ReactNode;
}) {
  return (
    <div className="barber-shell">
      <div className="dcb-cmp">
        <header className="dcb-cmp__nav">
          <div className="dcb-cmp__navIn">
            <Link href={RUTA_LANDING} className="dcb-cmp__brand">
              <span className="dcb-cmp__brandMark" aria-hidden="true">
                <Scissors size={15} />
              </span>
              {t("barber.comparar.nav.marca")}
            </Link>
            <span className="dcb-cmp__navSpacer" />
            <Link href={RUTA_INDICE} className="dcb-cmp__navLink">
              {t("barber.comparar.nav.comparar")}
            </Link>
            <Link href={RUTA_REGISTRO} className="dcb-cmp__btn dcb-cmp__btn--primary dcb-cmp__btn--sm">
              {t("barber.comparar.nav.cta")}
            </Link>
          </div>
        </header>

        <main className="dcb-cmp__main">{children}</main>

        <footer className="dcb-cmp__footer">
          <div className="dcb-cmp__footerIn">
            <p>{t("barber.comparar.footer.aviso", { fecha: REVISADO_EL_TEXTO })}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Encabezado ──────────────────────────────────────────────────────────

export function Encabezado({
  kicker,
  titulo,
  lede,
  volver,
}: {
  kicker: string;
  titulo: string;
  lede: string;
  volver?: { href: string; label: string };
}) {
  return (
    <div className="dcb-cmp__wrap">
      <div className="dcb-cmp__head">
        {volver ? (
          <div>
            <Link href={volver.href} className="dcb-cmp__back">
              <ArrowLeft size={14} />
              {volver.label}
            </Link>
          </div>
        ) : null}
        <span className="dcb-cmp__kicker">{kicker}</span>
        <h1 className="dcb-cmp__h1">{titulo}</h1>
        <p className="dcb-cmp__lede">{lede}</p>
      </div>
    </div>
  );
}

export function Seccion({
  titulo,
  sub,
  children,
}: {
  titulo: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dcb-cmp__section">
      <h2 className="dcb-cmp__h2">{titulo}</h2>
      {sub ? <p className="dcb-cmp__sub">{sub}</p> : null}
      {children}
    </section>
  );
}

export function Nota({ children }: { children: React.ReactNode }) {
  return (
    <p className="dcb-cmp__note">
      <Info size={15} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// ── Tabla lado a lado ───────────────────────────────────────────────────

export function TablaLadoALado({
  competidor,
  planes,
  t,
}: {
  competidor: Competidor;
  planes: BarberResolvedPlan[];
  t: TFunction;
}) {
  const nosotros = t("barber.comparar.tabla.colNosotros");

  return (
    <Seccion titulo={t("barber.comparar.tabla.titulo")}>
      <div className="dcb-cmp__table">
        <div className="dcb-cmp__thead" aria-hidden="true">
          <div className="dcb-cmp__th">{t("barber.comparar.tabla.colEje")}</div>
          <div className="dcb-cmp__th dcb-cmp__th--us">{nosotros}</div>
          <div className="dcb-cmp__th">{competidor.nombre}</div>
        </div>

        {EJES.map((eje) => {
          const suyo = competidor.ejes[eje.id];
          const f = fuente(suyo.fuenteId);
          return (
            <div className="dcb-cmp__row" key={eje.id}>
              <div className="dcb-cmp__eje">{eje.label}</div>

              <div className="dcb-cmp__cell dcb-cmp__cell--us">
                <div className="dcb-cmp__cellLabel">{nosotros}</div>
                <div className="dcb-cmp__cellText">{nuestroEje(eje.id, planes)}</div>
              </div>

              <div className="dcb-cmp__cell">
                <div className="dcb-cmp__cellLabel">{competidor.nombre}</div>
                <div className="dcb-cmp__cellText">{suyo.texto}</div>
                {suyo.nota ? <div className="dcb-cmp__cellNote">{suyo.nota}</div> : null}
                {f ? <div className="dcb-cmp__cellNote">Fuente: {f.label}.</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      <Nota>{t("barber.comparar.tabla.notaComparabilidad")}</Nota>
    </Seccion>
  );
}

// ── Escenarios: el cálculo enseñado ─────────────────────────────────────

export function TablaEscenarios({
  competidor,
  planes,
  t,
}: {
  competidor: Competidor;
  planes: BarberResolvedPlan[];
  t: TFunction;
}) {
  const filas = escenarios(competidor, planes);

  return (
    <Seccion
      titulo={t("barber.comparar.escenarios.titulo")}
      sub={t("barber.comparar.escenarios.lede")}
    >
      <div className="dcb-cmp__scn">
        <div className="dcb-cmp__scnRow dcb-cmp__scnRow--head">
          <div className="dcb-cmp__scnCell">{t("barber.comparar.escenarios.colEquipo")}</div>
          <div className="dcb-cmp__scnCell dcb-cmp__scnCell--us">
            {t("barber.comparar.escenarios.colNosotros")}
          </div>
          <div className="dcb-cmp__scnCell">{competidor.nombre}</div>
        </div>

        {filas.map((fila) => (
          <div className="dcb-cmp__scnRow" key={fila.barberos}>
            <div className="dcb-cmp__scnCell dcb-cmp__scnTeam">
              {fila.barberos === 1
                ? t("barber.comparar.escenarios.unBarbero")
                : t("barber.comparar.escenarios.nBarberos", { n: fila.barberos })}
            </div>

            <div className="dcb-cmp__scnCell dcb-cmp__scnCell--us">
              <span className="dcb-cmp__scnMoney">{fila.nosotros}</span>
              <span className="dcb-cmp__scnSub">
                {t("barber.comparar.escenarios.planNota", { plan: fila.nosotrosPlan })}
              </span>
            </div>

            <div className="dcb-cmp__scnCell">
              <span className="dcb-cmp__scnMoney">{fila.ellos}</span>
              {fila.ellosNota ? (
                <span className="dcb-cmp__scnSub">{fila.ellosNota}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Nota>
        <strong>{t("barber.comparar.escenarios.supuestoTitulo")}:</strong> {competidor.supuesto}
      </Nota>
      <Nota>{t("barber.comparar.escenarios.soloSuscripcion")}</Nota>
    </Seccion>
  );
}

// ── En qué es mejor el competidor ───────────────────────────────────────

export function Fortalezas({
  competidor,
  planes,
  t,
}: {
  competidor: Competidor;
  planes: BarberResolvedPlan[];
  t: TFunction;
}) {
  const calculadas = competidor.fortalezasCalculadas?.(planes) ?? [];
  const todas = [...competidor.fortalezas, ...calculadas];
  if (todas.length === 0) return null;

  return (
    <Seccion
      titulo={t("barber.comparar.fortalezas.titulo", { competidor: competidor.nombre })}
      sub={t("barber.comparar.fortalezas.lede")}
    >
      <div className="dcb-cmp__card">
        <ul className="dcb-cmp__list dcb-cmp__list--quiet">
          {todas.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    </Seccion>
  );
}

// ── Dónde estamos mejor nosotros ────────────────────────────────────────

export function Ventajas({ competidor, t }: { competidor: Competidor; t: TFunction }) {
  if (competidor.ventajas.length === 0) return null;

  return (
    <Seccion
      titulo={t("barber.comparar.ventajas.titulo")}
      sub={t("barber.comparar.ventajas.lede")}
    >
      <div className="dcb-cmp__card dcb-cmp__card--us">
        <ul className="dcb-cmp__list">
          {competidor.ventajas.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      </div>
    </Seccion>
  );
}

// ── Lo que reportan usuarios (nunca como hecho) ─────────────────────────

export function Reportes({ competidor, t }: { competidor: Competidor; t: TFunction }) {
  if (competidor.reportanUsuarios.length === 0) return null;

  // Se agrupan por fuente para que la fórmula "usuarios reportan en X" salga
  // una vez y quede claro de dónde viene CADA punto.
  const porFuente = new Map<string, string[]>();
  for (const r of competidor.reportanUsuarios) {
    const lista = porFuente.get(r.fuenteId) ?? [];
    lista.push(r.texto);
    porFuente.set(r.fuenteId, lista);
  }

  return (
    <Seccion titulo={t("barber.comparar.reportes.titulo")}>
      <div className="dcb-cmp__card dcb-cmp__card--quiet">
        {Array.from(porFuente.entries()).map(([fuenteId, textos]) => {
          const f = fuente(fuenteId);
          return (
            <div key={fuenteId}>
              <p className="dcb-cmp__reportHead">
                {t("barber.comparar.reportes.formula", {
                  fuente: f ? f.label : fuenteId,
                })}
              </p>
              <ul className="dcb-cmp__list dcb-cmp__list--quiet">
                {textos.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="dcb-cmp__disclaimer">{t("barber.comparar.reportes.aviso")}</p>
      </div>
    </Seccion>
  );
}

// ── Fuentes + sello de fecha ────────────────────────────────────────────

export function Fuentes({ fuentes, t }: { fuentes: Fuente[]; t: TFunction }) {
  return (
    <Seccion titulo={t("barber.comparar.fuentes.titulo")}>
      <ul className="dcb-cmp__srcList">
        {fuentes.map((f) => (
          <li key={f.id}>
            {f.label}
            {". "}
            {f.url ? (
              <a
                className="dcb-cmp__srcLink"
                href={f.url}
                target="_blank"
                rel="nofollow noopener noreferrer"
              >
                {f.url.replace(/^https?:\/\//, "")}
                <ExternalLink size={13} />
              </a>
            ) : (
              <span className="dcb-cmp__srcNone">
                {t("barber.comparar.fuentes.sinEnlace")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="dcb-cmp__stamp">
        <CalendarCheck size={15} aria-hidden="true" />
        <span>
          <time dateTime={REVISADO_EL}>
            {t("barber.comparar.fuentes.revisado", { fecha: REVISADO_EL_TEXTO })}
          </time>{" "}
          {t("barber.comparar.fuentes.verifica")}
        </span>
      </p>
    </Seccion>
  );
}

// ── Cierre ──────────────────────────────────────────────────────────────

export function BloqueCta({ t, conSecundario }: { t: TFunction; conSecundario?: boolean }) {
  return (
    <div className="dcb-cmp__cta">
      <h2 className="dcb-cmp__ctaTitle">{t("barber.comparar.cta.titulo")}</h2>
      <p className="dcb-cmp__ctaLede">{t("barber.comparar.cta.lede")}</p>
      <div className="dcb-cmp__ctaRow">
        <Link href={RUTA_REGISTRO} className="dcb-cmp__btn dcb-cmp__btn--primary">
          {t("barber.comparar.cta.boton")}
          <ArrowRight size={16} />
        </Link>
        {conSecundario ? (
          <Link href={RUTA_INDICE} className="dcb-cmp__btn dcb-cmp__btn--ghost">
            {t("barber.comparar.cta.secundario")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// ── Índice: tarjeta por competidor ──────────────────────────────────────

export function TarjetaCompetidor({
  competidor,
  t,
}: {
  competidor: Competidor;
  t: TFunction;
}) {
  return (
    <Link href={`${RUTA_INDICE}/${competidor.slug}`} className="dcb-cmp__tile">
      <span className="dcb-cmp__tileName">{competidor.nombre}</span>
      <span className="dcb-cmp__tilePrice">{competidor.ejes.precio.texto}</span>
      <p className="dcb-cmp__tileText">{competidor.resumen}</p>
      <span className="dcb-cmp__tileGo">
        {t("barber.comparar.indice.verPagina", { competidor: competidor.nombre })}
        <ArrowRight size={15} />
      </span>
    </Link>
  );
}

// ── Índice: fila del panorama ───────────────────────────────────────────

export function FilaPanorama({
  nombre,
  precio,
  origen,
  nota,
  fuenteId,
  destacada,
}: {
  nombre: string;
  precio: string;
  origen: string;
  nota: string;
  fuenteId?: string;
  destacada?: boolean;
}) {
  const f = fuenteId ? fuente(fuenteId) : null;
  return (
    <div className={`dcb-cmp__panRow${destacada ? " dcb-cmp__panRow--us" : ""}`}>
      <div className="dcb-cmp__panHead">
        <span className="dcb-cmp__panName">{nombre}</span>
        <span className="dcb-cmp__panOrigin">{origen}</span>
        <span className="dcb-cmp__panPrice">{precio}</span>
      </div>
      <p className="dcb-cmp__panNote">{nota}</p>
      {f ? <p className="dcb-cmp__panSrc">Fuente: {f.label}.</p> : null}
    </div>
  );
}

// ── Icono suelto para el índice (WhatsApp incluido) ─────────────────────
export const IconoMensaje = MessageSquare;
