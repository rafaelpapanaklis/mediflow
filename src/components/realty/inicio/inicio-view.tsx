/* ═══════════════════════════════════════════════════════════════════════
   EL INICIO — la pantalla.

   Componente de SERVIDOR: pinta lo que ya decidió getRealtyInicio y no
   tiene una sola isla de cliente. Un tablero que solo muestra números no
   necesita hidratarse, y el Inicio es la pantalla que más se abre: cada
   kilobyte de JS que no manda aquí se nota en el celular del asesor.

   🔴 DOS REGLAS QUE GOBIERNAN TODO ESTE ARCHIVO:

   1. NUNCA UN CERO MUDO. Una tarjeta sin datos no pinta "0": pinta qué
      hacer para que deje de estar vacía, con la liga a donde se hace. Un
      cero grande y solo no dice si la persona va bien, si le falta
      configurar algo o si el producto está roto — y las tres lecturas
      llevan a soporte.
   2. `null` = no lo puede ver (modo, plan o permiso) → la tarjeta NO
      existe. `0`/`[]` = lo ve y está vacío → la tarjeta existe con su
      vacío útil. La decisión ya la tomó el servidor; aquí solo se respeta.

   Cada tarjeta lleva a SU pantalla, y solo aparece si la persona puede
   abrirla — eso también lo decidió el servidor con el mismo
   REALTY_NAV_ITEMS que arma el sidebar.
   ═══════════════════════════════════════════════════════════════════════ */
import Link from "next/link";
import type { TFunction } from "@/i18n/t";
import {
  duracionCorta,
  pesosDeCentavos,
  tarjetaInicio,
  type RealtyInicioData,
  type RealtyInicioUrgencia,
} from "@/lib/realty/inicio-shared";
// La hoja `dcri-` se importa desde la PÁGINA
// (src/app/inmobiliaria/(panel)/inicio/page.tsx), igual que hace el Inicio
// de barber con dashboard.css: es CSS global, y el sitio donde el repo ya
// los cuelga es la página.

export interface InicioViewProps {
  data: RealtyInicioData;
  t: TFunction;
  locale: string;
  timezone: string;
}

export function InicioView({ data, t, locale, timezone }: InicioViewProps) {
  const k = (key: string, vars?: Record<string, string | number>) =>
    t(`realty.inicio.${key}`, vars);
  const intl = locale === "en" ? "en-US" : "es-MX";

  const hora = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(intl, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone || "America/Mexico_City",
      }).format(new Date(iso));
    } catch {
      return "—";
    }
  };

  const dia = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(intl, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(iso));
    } catch {
      return "—";
    }
  };

  return (
    <div className="realty-page">
      <header className="dcri-cabeza">
        <h1 className="dcri-titulo">
          {data.nombre ? k("hello", { name: data.nombre }) : k("helloNoName")}
        </h1>
        <p className="dcri-sub">{k(`sub.${data.modo}`)}</p>
      </header>

      {data.recienLlegado ? (
        <Arranque data={data} k={k} />
      ) : (
        <div className="dcri-rejilla">
          {/* ── Lo que decide qué hace la persona AHORA ─────────────── */}
          {data.prospectos ? (
            <Card
              titulo={k("card.prospectos.title")}
              ancha
              urgente={data.prospectos.rojo > 0}
              href={tarjetaInicio("prospectos").href}
              cta={k("card.prospectos.cta")}
              nota={
                data.prospectos.total > 0
                  ? k("card.prospectos.foot", { minutes: 10 })
                  : undefined
              }
            >
              {data.prospectos.total === 0 ? (
                <Vacio
                  titulo={
                    data.prospectos.hayAlguno
                      ? k("card.prospectos.clear.title")
                      : k("card.prospectos.empty.title")
                  }
                  cuerpo={
                    data.prospectos.hayAlguno
                      ? k("card.prospectos.clear.body")
                      : k("card.prospectos.empty.body")
                  }
                />
              ) : (
                <>
                  <Cifra
                    n={data.prospectos.truncado ? `${data.prospectos.total}+` : data.prospectos.total}
                    que={k("card.prospectos.value")}
                    alerta={data.prospectos.rojo > 0}
                  />
                  <div className="dcri-semaforo">
                    <Luz urgencia="ROJO" n={data.prospectos.rojo} texto={k("heat.rojo")} />
                    <Luz
                      urgencia="AMARILLO"
                      n={data.prospectos.amarillo}
                      texto={k("heat.amarillo")}
                    />
                    <Luz urgencia="VERDE" n={data.prospectos.verde} texto={k("heat.verde")} />
                  </div>
                  <div className="dcri-lista">
                    {data.prospectos.primeros.map((p) => (
                      <div className="dcri-fila" key={p.id}>
                        <span
                          className={`dcri-punto dcri-punto--${p.urgencia.toLowerCase()}`}
                          aria-hidden="true"
                        />
                        <span className="dcri-fila-main">
                          <span className="dcri-fila-nombre">{p.nombre}</span>
                          <span className="dcri-fila-meta">
                            {p.asesor ?? k("card.prospectos.unassigned")}
                          </span>
                        </span>
                        <span className="dcri-fila-dato">{duracionCorta(p.minutos)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {/* ── El día ──────────────────────────────────────────────── */}
          {data.visitas ? (
            <Card
              titulo={k("card.visitas.title")}
              href={tarjetaInicio("visitas").href}
              cta={k("card.visitas.cta")}
              nota={
                data.visitas.porConfirmar > 0
                  ? k("card.visitas.toConfirm", { count: data.visitas.porConfirmar })
                  : undefined
              }
            >
              {data.visitas.total === 0 ? (
                <Vacio titulo={k("card.visitas.empty.title")} cuerpo={k("card.visitas.empty.body")} />
              ) : (
                <>
                  <Cifra
                    n={data.visitas.truncado ? `${data.visitas.total}+` : data.visitas.total}
                    que={k("card.visitas.value")}
                  />
                  <div className="dcri-lista">
                    {data.visitas.proximas.map((v) => (
                      <div className="dcri-fila" key={v.id}>
                        <span className="dcri-fila-hora">{hora(v.hora)}</span>
                        <span className="dcri-fila-main">
                          <span className="dcri-fila-nombre">{v.inmueble}</span>
                          <span className="dcri-fila-meta">
                            {[v.donde, v.asesor].filter(Boolean).join(" · ") ||
                              k("card.visitas.noAgent")}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {data.tareasVencidas !== null ? (
            <Card
              titulo={k("card.tareas.title")}
              urgente={data.tareasVencidas > 0}
              href={tarjetaInicio("tareas").href}
              cta={k("card.tareas.cta")}
            >
              {data.tareasVencidas === 0 ? (
                <Vacio titulo={k("card.tareas.clear.title")} cuerpo={k("card.tareas.clear.body")} />
              ) : (
                <Cifra n={data.tareasVencidas} que={k("card.tareas.value")} alerta />
              )}
            </Card>
          ) : null}

          {/* ── La cartera ──────────────────────────────────────────── */}
          {data.inmuebles ? (
            <Card
              titulo={k("card.inmuebles.title")}
              href={tarjetaInicio("inmuebles").href}
              cta={k("card.inmuebles.cta")}
              nota={
                data.inmuebles.total > data.inmuebles.publicados
                  ? k("card.inmuebles.unpublished", {
                      count: data.inmuebles.total - data.inmuebles.publicados,
                    })
                  : undefined
              }
            >
              {data.inmuebles.total === 0 ? (
                <Vacio
                  titulo={k("card.inmuebles.empty.title")}
                  cuerpo={k("card.inmuebles.empty.body")}
                />
              ) : (
                <>
                  <Cifra n={data.inmuebles.publicados} que={k("card.inmuebles.value")} />
                  {data.inmuebles.sinFotos > 0 ? (
                    <p className="dcri-vacio-cuerpo">
                      {k("card.inmuebles.noPhotos", { count: data.inmuebles.sinFotos })}
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          ) : null}

          {data.exclusivas ? (
            <Card
              titulo={k("card.exclusivas.title")}
              urgente={data.exclusivas.some((e) => e.dias <= 7)}
              href={tarjetaInicio("exclusivas").href}
              cta={k("card.exclusivas.cta")}
            >
              {data.exclusivas.length === 0 ? (
                <Vacio
                  titulo={k("card.exclusivas.clear.title")}
                  cuerpo={k("card.exclusivas.clear.body")}
                />
              ) : (
                <>
                  <Cifra
                    n={data.exclusivasTruncado ? `${data.exclusivas.length}+` : data.exclusivas.length}
                    que={k("card.exclusivas.value")}
                  />
                  <div className="dcri-lista">
                    {data.exclusivas.slice(0, 4).map((e) => (
                      <div className="dcri-fila" key={e.id}>
                        <span className="dcri-fila-main">
                          <span className="dcri-fila-nombre">{e.inmueble}</span>
                        </span>
                        <span className="dcri-fila-dato">
                          {k("card.exclusivas.days", { count: e.dias })}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {/* ── El equipo (solo AGENCY) ─────────────────────────────── */}
          {data.ranking ? (
            <Card
              titulo={k("card.ranking.title")}
              href={tarjetaInicio("ranking").href}
              cta={k("card.ranking.cta")}
            >
              {data.ranking.length === 0 ? (
                <Vacio titulo={k("card.ranking.empty.title")} cuerpo={k("card.ranking.empty.body")} />
              ) : (
                <div className="dcri-lista">
                  {data.ranking.map((r) => (
                    <div className="dcri-fila" key={r.userId}>
                      <span className="dcri-fila-main">
                        <span className="dcri-fila-nombre">{r.nombre}</span>
                        <span className="dcri-fila-meta">
                          {k("card.ranking.ops", { count: r.operaciones })}
                        </span>
                      </span>
                      <span className="dcri-fila-dato">{pesosDeCentavos(r.comisionCents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {/* ── Lo mío (solo AGENT) ─────────────────────────────────── */}
          {data.comisiones ? (
            <Card
              titulo={k("card.comisiones.title")}
              href={tarjetaInicio("comisiones").href}
              cta={k("card.comisiones.cta")}
              nota={data.comisiones.periodoLabel}
            >
              {data.comisiones.operaciones === 0 ? (
                <Vacio
                  titulo={k("card.comisiones.empty.title")}
                  cuerpo={k("card.comisiones.empty.body")}
                />
              ) : (
                <>
                  <Cifra
                    n={pesosDeCentavos(data.comisiones.porCobrarCents)}
                    que={k("card.comisiones.pending")}
                    dinero
                  />
                  <p className="dcri-vacio-cuerpo">
                    {k("card.comisiones.collected", {
                      amount: pesosDeCentavos(data.comisiones.cobradoCents),
                      count: data.comisiones.operaciones,
                    })}
                  </p>
                </>
              )}
            </Card>
          ) : null}

          {/* ── Administrar: el dinero de la renta ──────────────────── */}
          {data.cobranza ? (
            <Card
              titulo={k("card.cobranza.title")}
              urgente={data.cobranza.vencidoCents > 0}
              href={tarjetaInicio("cobranza").href}
              cta={k("card.cobranza.cta")}
              nota={data.cobranza.periodoLabel}
            >
              {data.cobranza.cargadoCents === 0 ? (
                <Vacio
                  titulo={k("card.cobranza.empty.title")}
                  cuerpo={k("card.cobranza.empty.body")}
                />
              ) : (
                <>
                  <Cifra
                    n={pesosDeCentavos(data.cobranza.porCobrarCents, data.cobranza.moneda)}
                    que={k("card.cobranza.value")}
                    dinero
                    alerta={data.cobranza.vencidoCents > 0}
                  />
                  <p className="dcri-vacio-cuerpo">
                    {data.cobranza.vencidoCents > 0
                      ? k("card.cobranza.overdue", {
                          amount: pesosDeCentavos(data.cobranza.vencidoCents, data.cobranza.moneda),
                          count: data.cobranza.vencidos,
                        })
                      : k("card.cobranza.onTime")}
                  </p>
                </>
              )}
            </Card>
          ) : null}

          {data.deudores ? (
            <Card
              titulo={k("card.deudores.title")}
              urgente={data.deudores.length > 0}
              href={tarjetaInicio("deudores").href}
              cta={k("card.deudores.cta")}
            >
              {data.deudores.length === 0 ? (
                <Vacio
                  titulo={k("card.deudores.clear.title")}
                  cuerpo={k("card.deudores.clear.body")}
                />
              ) : (
                <div className="dcri-lista">
                  {data.deudores.map((d) => (
                    <div className="dcri-fila" key={d.id}>
                      <span className="dcri-fila-main">
                        <span className="dcri-fila-nombre">{d.quien}</span>
                        <span className="dcri-fila-meta">
                          {k("card.deudores.since", { date: dia(d.desde), days: d.diasTarde })} ·{" "}
                          {d.inmueble}
                        </span>
                      </span>
                      <span className="dcri-fila-dato">
                        {pesosDeCentavos(d.saldoCents, d.moneda)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {data.contratos ? (
            <Card
              titulo={k("card.contratos.title")}
              href={tarjetaInicio("contratos").href}
              cta={k("card.contratos.cta")}
            >
              {data.contratos.length === 0 ? (
                <Vacio
                  titulo={k("card.contratos.clear.title")}
                  cuerpo={k("card.contratos.clear.body")}
                />
              ) : (
                <>
                  <Cifra
                    n={
                      data.contratosTruncado
                        ? `${data.contratos.length}+`
                        : data.contratos.length
                    }
                    que={k("card.contratos.value")}
                  />
                  <div className="dcri-lista">
                    {data.contratos.slice(0, 4).map((c) => (
                      <div className="dcri-fila" key={c.id}>
                        <span className="dcri-fila-main">
                          <span className="dcri-fila-nombre">{c.inmueble}</span>
                        </span>
                        <span className="dcri-fila-dato">
                          {k("card.contratos.days", { count: c.dias })}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {data.mantenimientos ? (
            <Card
              titulo={k("card.mantenimientos.title")}
              urgente={data.mantenimientos.some((m) => m.dias >= 7)}
              href={tarjetaInicio("mantenimientos").href}
              cta={k("card.mantenimientos.cta")}
            >
              {data.mantenimientos.length === 0 ? (
                <Vacio
                  titulo={k("card.mantenimientos.clear.title")}
                  cuerpo={k("card.mantenimientos.clear.body")}
                />
              ) : (
                <>
                  <Cifra
                    n={
                      data.mantenimientosTruncado
                        ? `${data.mantenimientos.length}+`
                        : data.mantenimientos.length
                    }
                    que={k("card.mantenimientos.value")}
                    alerta={data.mantenimientos.some((m) => m.dias >= 7)}
                  />
                  <div className="dcri-lista">
                    {data.mantenimientos.slice(0, 4).map((m) => (
                      <div className="dcri-fila" key={m.id}>
                        <span className="dcri-fila-main">
                          <span className="dcri-fila-nombre">{m.inmueble}</span>
                          <span className="dcri-fila-meta">
                            {m.enProceso
                              ? k("card.mantenimientos.inProgress")
                              : k("card.mantenimientos.open")}
                          </span>
                        </span>
                        <span className="dcri-fila-dato">
                          {k("card.mantenimientos.days", { count: m.dias })}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {data.vacias !== null ? (
            <Card
              titulo={k("card.vacias.title")}
              href={tarjetaInicio("vacias").href}
              cta={k("card.vacias.cta")}
            >
              {data.vacias === 0 ? (
                <Vacio titulo={k("card.vacias.clear.title")} cuerpo={k("card.vacias.clear.body")} />
              ) : (
                <Cifra n={data.vacias} que={k("card.vacias.value")} />
              )}
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Piezas ─────────────────────────────────────────────────────────── */

function Card({
  titulo,
  children,
  href,
  cta,
  nota,
  ancha,
  urgente,
}: {
  titulo: string;
  children: React.ReactNode;
  href: string;
  cta: string;
  nota?: string;
  ancha?: boolean;
  urgente?: boolean;
}) {
  return (
    <section
      className={[
        "dcri-card",
        ancha ? "dcri-ancha" : "",
        urgente ? "dcri-card--urgente" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="dcri-card-cabeza">
        <h2 className="dcri-card-titulo">{titulo}</h2>
      </div>
      <div className="dcri-card-cuerpo">{children}</div>
      {/* El pie SIEMPRE lleva a la pantalla de la tarjeta, tenga datos o
          no: cuando está vacía es justamente cuando hace falta ir. */}
      <div className="dcri-card-pie">
        <span className="dcri-pie-nota">{nota ?? ""}</span>
        <Link href={href} className="dcri-liga">
          {cta} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

function Cifra({
  n,
  que,
  dinero,
  alerta,
}: {
  n: number | string;
  que: string;
  dinero?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="dcri-cifra">
      <span
        className={[
          "dcri-cifra-n",
          dinero ? "dcri-cifra-n--dinero" : "",
          alerta ? "dcri-cifra-n--alerta" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {n}
      </span>
      <span className="dcri-cifra-que">{que}</span>
    </div>
  );
}

function Luz({
  urgencia,
  n,
  texto,
}: {
  urgencia: RealtyInicioUrgencia;
  n: number;
  texto: string;
}) {
  if (n === 0) return null;
  return (
    <span className={`dcri-luz dcri-luz--${urgencia.toLowerCase()}`}>
      <span className="dcri-luz-punto" aria-hidden="true" />
      {n} {texto}
    </span>
  );
}

function Vacio({ titulo, cuerpo }: { titulo: string; cuerpo: string }) {
  return (
    <div className="dcri-vacio">
      <span className="dcri-vacio-titulo">{titulo}</span>
      <span className="dcri-vacio-cuerpo">{cuerpo}</span>
    </div>
  );
}

/**
 * El primer día.
 *
 * Una cuenta estrenada NO ve un tablero de ceros: ve qué hacer, en orden, y
 * cada paso es una liga. Un tablero vacío se lee como "el producto no
 * funciona"; una lista de arranque se lee como "empieza por aquí".
 */
function Arranque({
  data,
  k,
}: {
  data: RealtyInicioData;
  k: (key: string, vars?: Record<string, string | number>) => string;
}) {
  // 🔴 Cada paso se pinta SOLO si esta persona puede darlo. Un paso que
  // lleva a una pantalla cerrada es un clic hasta un denied, y esta es la
  // única pantalla que ve una cuenta nueva: no hay nada más que hacer ahí.
  const pasos: { key: string; href: string }[] = [
    ...(data.puede.inmuebleNuevo
      ? [{ key: "inmueble", href: "/inmobiliaria/inmuebles/nuevo" }]
      : []),
    ...(data.prospectos ? [{ key: "prospecto", href: "/inmobiliaria/prospectos" }] : []),
    ...(data.puede.rentas ? [{ key: "contrato", href: "/inmobiliaria/rentas" }] : []),
    ...(data.puede.web ? [{ key: "web", href: "/inmobiliaria/mi-web" }] : []),
    ...(data.puede.equipo ? [{ key: "equipo", href: "/inmobiliaria/equipo" }] : []),
  ];

  return (
    <section className="dcri-card">
      <div className="dcri-card-cabeza">
        <h2 className="dcri-card-titulo">{k("fresh.title")}</h2>
      </div>
      <div className="dcri-card-cuerpo">
        <p className="dcri-vacio-cuerpo">{k("fresh.body")}</p>
        <div className="dcri-arranque">
          {pasos.map((p, i) => (
            <Link key={p.key} href={p.href} className="dcri-paso">
              <span className="dcri-paso-n" aria-hidden="true">
                {i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="dcri-paso-titulo">{k(`fresh.${p.key}`)}</span>
                <span className="dcri-paso-ayuda">{k(`fresh.${p.key}Hint`)}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
