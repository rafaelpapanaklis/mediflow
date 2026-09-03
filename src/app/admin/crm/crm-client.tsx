"use client";

// ═══════════════════════════════════════════════════════════════════════
// La pantalla del CRM de ventas: HOY TOCA arriba, embudo abajo.
//
// El orden no es decorativo. Un CRM no se abre para admirar el embudo: se
// abre para saber a quién hay que buscar hoy. Por eso lo primero de la
// página es la lista de seguimientos vencidos y de hoy, con los botones
// para escribirle, marcarle o posponer sin salir de ahí; el tablero viene
// después, para ver cómo va todo.
//
// ── QUIÉN MANDA SOBRE LAS FILAS ────────────────────────────────────────
// La lista llega del servidor y se guarda en estado local para poder
// pintar el cambio ANTES de que conteste la acción (arrastrar una tarjeta
// tiene que sentirse instantáneo). Cada acción termina en router.refresh()
// y el useEffect vuelve a tomar lo que diga el servidor: el estado local
// es un adelanto, nunca la verdad.
//
// Buscar y filtrar se hacen aquí, en el navegador, sobre la lista ya
// cargada — ver el comentario de `crmCoincide` para los dos motivos.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  CalendarClock,
  Flame,
  Handshake,
  LayoutGrid,
  List,
  Plus,
  Search,
  Target,
  Trophy,
  Upload,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  crmCoincide,
  crmDiaRelativo,
  crmEstaFrio,
  crmEtapa,
  crmPrioridad,
  crmResumen,
  crmSemaforo,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import type { CrmListado, CrmProspectoDTO } from "@/lib/admin/crm/service";
import { moverEtapaAccion, programarSeguimientoAccion } from "./actions";
import { CrmFormulario } from "./crm-form";
import { CrmImportar } from "./crm-importar";
import { CrmLista } from "./crm-lista";
import { CrmTablero } from "./crm-tablero";
import {
  CrmAccionesContacto,
  CrmAvatar,
  CrmMotivoPerdida,
  CrmSemaforoChip,
  CrmVerticalChip,
  crmFmtMxn,
} from "./crm-ui";

type Vista = "tablero" | "lista";
type Orden = "prioridad" | "reciente" | "valor" | "nombre";

/** Valores especiales del filtro de origen; el resto es un affiliateId. */
const ORIGEN_DALECONTROL = "__dalecontrol";
const ORIGEN_AFILIADOS = "__afiliados";

const ORDENES: { id: Orden; label: string }[] = [
  { id: "prioridad", label: "Por atender" },
  { id: "reciente", label: "Más recientes" },
  { id: "valor", label: "Mayor valor" },
  { id: "nombre", label: "Nombre" },
];

export function CrmClient({ listado }: { listado: CrmListado }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // La verdad la manda el servidor; esto es el adelanto para que arrastrar
  // se sienta instantáneo. Se vuelve a tomar en cada refresco.
  const [filas, setFilas] = useState<CrmProspectoDTO[]>(listado.filas);
  useEffect(() => {
    setFilas(listado.filas);
  }, [listado.filas]);

  // "Ahora" se congela por render de datos: si se recalculara en cada
  // pintado, un prospecto podría cambiar de "hoy" a "vencido" a media
  // interacción. Se refresca cuando llegan datos nuevos.
  const ahora = useMemo(() => new Date(), [listado.filas]);

  const [vista, setVista] = useState<Vista>("tablero");
  const [q, setQ] = useState("");
  const [vertical, setVertical] = useState("");
  const [fuente, setFuente] = useState("");
  const [etapaFiltro, setEtapaFiltro] = useState("");
  const [origen, setOrigen] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [orden, setOrden] = useState<Orden>("prioridad");

  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [perdiendo, setPerdiendo] = useState<CrmProspectoDTO | null>(null);

  const resumen = useMemo(() => crmResumen(filas, ahora), [filas, ahora]);

  // Los socios que aparecen en la lista, para poder filtrar por uno. Se
  // sacan de las filas y no de la tabla de afiliados: aquí sólo importan
  // los que efectivamente recomendaron algo.
  const socios = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of filas) {
      if (p.affiliateId) mapa.set(p.affiliateId, p.affiliateName ?? "Socio dado de baja");
    }
    return Array.from(mapa.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [filas]);

  const deAfiliados = useMemo(() => filas.filter((p) => !!p.affiliateId).length, [filas]);

  /**
   * Recomendaciones de socios que nadie ha tocado todavía. Merecen aviso
   * propio y no un badge más: un socio que recomienda y ve que nunca lo
   * contactamos deja de recomendar, y estas no entran en "hoy toca" porque
   * nacen sin fecha de seguimiento.
   */
  const deSociosSinTocar = useMemo(
    () => filas.filter((p) => !!p.affiliateId && crmEtapa(p.stage).id === "NUEVO"),
    [filas],
  );

  const filtradas = useMemo(() => {
    const lista = filas.filter((p) => {
      if (vertical && p.vertical !== vertical) return false;
      if (fuente && p.source !== fuente) return false;
      if (origen === ORIGEN_DALECONTROL && p.affiliateId) return false;
      if (origen === ORIGEN_AFILIADOS && !p.affiliateId) return false;
      if (origen && origen !== ORIGEN_DALECONTROL && origen !== ORIGEN_AFILIADOS) {
        if (p.affiliateId !== origen) return false;
      }
      if (etapaFiltro && crmEtapa(p.stage).id !== etapaFiltro) return false;
      if (soloPendientes) {
        const s = crmSemaforo(p.nextActionAt, ahora);
        if (s !== "vencido" && s !== "hoy") return false;
      }
      return crmCoincide(p, q);
    });
    const copia = [...lista];
    if (orden === "prioridad") {
      copia.sort((a, b) => crmPrioridad(a, ahora) - crmPrioridad(b, ahora) || a.name.localeCompare(b.name, "es"));
    } else if (orden === "reciente") {
      copia.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } else if (orden === "valor") {
      copia.sort((a, b) => (Number(b.monthlyValue) || 0) - (Number(a.monthlyValue) || 0));
    } else {
      copia.sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    return copia;
  }, [filas, vertical, fuente, origen, etapaFiltro, soloPendientes, q, orden, ahora]);

  /** Los que hay que buscar hoy: vencidos primero, luego los de hoy. */
  const hoyToca = useMemo(
    () =>
      filas
        .filter((p) => {
          if (crmEtapa(p.stage).terminal) return false;
          const s = crmSemaforo(p.nextActionAt, ahora);
          return s === "vencido" || s === "hoy";
        })
        .sort((a, b) => crmPrioridad(a, ahora) - crmPrioridad(b, ahora)),
    [filas, ahora],
  );

  // ── Mutaciones ────────────────────────────────────────────────────────

  /** Pinta el cambio de etapa YA y devuelve la anterior para poder revertir. */
  function pintarEtapa(id: string, etapa: string): string | null {
    let anterior: string | null = null;
    setFilas((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        anterior = p.stage;
        return { ...p, stage: etapa };
      }),
    );
    return anterior;
  }

  /**
   * EL único camino para cambiar de etapa: lo usan el arrastre del tablero
   * y el selector de la lista. Perder pregunta el motivo antes.
   */
  function mover(id: string, etapa: string, motivoPerdida?: string | null) {
    if (etapa === "PERDIDO" && motivoPerdida === undefined) {
      const p = filas.find((f) => f.id === id);
      if (p) {
        setPerdiendo(p);
        return;
      }
    }
    const anterior = pintarEtapa(id, etapa);
    startTransition(async () => {
      const r = await moverEtapaAccion(id, etapa, { motivoPerdida: motivoPerdida ?? null });
      if (!r.ok) {
        if (anterior) pintarEtapa(id, anterior);
        toast.error(r.error ?? "No se pudo mover.");
        return;
      }
      toast.success(`Movido a ${crmEtapa(etapa).label}.`);
      router.refresh();
    });
  }

  function reprogramar(p: CrmProspectoDTO, fecha: string | null) {
    setFilas((prev) =>
      prev.map((f) => (f.id === p.id ? { ...f, nextActionAt: fecha ? `${fecha}T12:00:00.000Z` : null } : f)),
    );
    startTransition(async () => {
      const r = await programarSeguimientoAccion(p.id, fecha, p.nextActionNote);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo reprogramar.");
        router.refresh();
        return;
      }
      toast.success(fecha ? "Listo, queda para después." : "Se quitó el próximo paso.");
      router.refresh();
    });
  }

  const vacio = filas.length === 0;

  return (
    <div>
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
            CRM de ventas
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 720 }}>
            A quién le queremos vender: clínicas, universidades, laboratorios. No son clientes —
            los que ya contrataron viven en Clínicas. Aquí se anota a quién le escribiste, a quién
            le marcaste y qué sigue con cada uno.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ButtonNew variant="secondary" icon={<Upload size={13} />} onClick={() => setImportando(true)}>
            Importar
          </ButtonNew>
          <ButtonNew variant="primary" icon={<Plus size={13} />} onClick={() => setCreando(true)}>
            Nuevo prospecto
          </ButtonNew>
        </div>
      </div>

      {vacio ? (
        <VacioInicial alCrear={() => setCreando(true)} alImportar={() => setImportando(true)} />
      ) : (
        <>
          {/* ── Los cuatro números ─────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <KpiCard
              label="Por atender"
              value={String(resumen.vencidos + resumen.paraHoy)}
              icon={CalendarClock}
              hero
              tone={resumen.vencidos > 0 ? "danger" : undefined}
              hint={
                resumen.vencidos > 0
                  ? `${resumen.vencidos} ${resumen.vencidos === 1 ? "vencido" : "vencidos"} y ${resumen.paraHoy} para hoy`
                  : "Seguimientos con fecha de hoy"
              }
            />
            <KpiCard
              label="En el embudo"
              value={String(resumen.abiertos)}
              icon={Target}
              hint={`${crmFmtMxn(resumen.valorAbierto)} al mes si cerraran todos`}
            />
            <KpiCard
              label="Enfriándose"
              value={String(resumen.frios)}
              icon={Flame}
              tone={resumen.frios > 0 ? "warning" : undefined}
              hint="Abiertos y sin nada anotado en 14 días"
            />
            <KpiCard
              label="Ya son clientes"
              value={String(resumen.ganados)}
              icon={Trophy}
              hint={resumen.perdidos > 0 ? `${resumen.perdidos} perdidos` : "Ganados desde que existe la lista"}
            />
          </div>

          {/* ── Lo que mandaron los socios y nadie ha tocado ─────────── */}
          {deSociosSinTocar.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 18,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--brand-soft)",
              }}
            >
              <Handshake size={16} style={{ color: "var(--brand)", flexShrink: 0 }} />
              <div style={{ flex: "1 1 320px", minWidth: 0, fontSize: 12.5, color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text-1)" }}>
                  {deSociosSinTocar.length}{" "}
                  {deSociosSinTocar.length === 1 ? "recomendación" : "recomendaciones"} de socios
                </strong>{" "}
                sin contactar todavía —{" "}
                {Array.from(
                  new Set(deSociosSinTocar.map((p) => p.affiliateName ?? "un socio dado de baja")),
                )
                  .slice(0, 3)
                  .join(", ")}
                . Un socio que recomienda y ve que nunca los buscamos deja de recomendar.
              </div>
              <ButtonNew
                size="sm"
                variant="secondary"
                onClick={() => {
                  setOrigen(ORIGEN_AFILIADOS);
                  setEtapaFiltro("NUEVO");
                  setVista("lista");
                }}
              >
                Verlas
              </ButtonNew>
            </div>
          )}

          {/* ── Hoy toca ───────────────────────────────────────────── */}
          {hoyToca.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <CardNew
                noPad
                title={`Hoy toca (${hoyToca.length})`}
                sub="Lo vencido primero. Escribe, marca o posponlo sin salir de aquí."
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {hoyToca.slice(0, 12).map((p) => (
                    <FilaHoy key={p.id} p={p} ahora={ahora} alPosponer={(f) => reprogramar(p, f)} />
                  ))}
                  {hoyToca.length > 12 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSoloPendientes(true);
                        setVista("lista");
                      }}
                      style={{
                        border: "none",
                        borderTop: "1px solid var(--border-soft)",
                        background: "transparent",
                        padding: "10px 14px",
                        fontSize: 12,
                        color: "var(--text-2)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      Ver los {hoyToca.length - 12} restantes en la lista →
                    </button>
                  )}
                </div>
              </CardNew>
            </div>
          )}

          {/* ── Filtros ────────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
              <Search
                size={13}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-4)",
                  pointerEvents: "none",
                }}
              />
              <input
                className="input-new"
                style={{ paddingLeft: 30 }}
                placeholder="Buscar por negocio, persona, ciudad, teléfono o nota…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar prospectos"
              />
            </div>

            <select
              className="input-new"
              style={{ width: 168 }}
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
              aria-label="Filtrar por giro"
            >
              <option value="">Todos los giros</option>
              {CRM_VERTICALES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>

            <select
              className="input-new"
              style={{ width: 168 }}
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
              aria-label="Filtrar por fuente"
            >
              <option value="">Todas las fuentes</option>
              {CRM_FUENTES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>

            {vista === "lista" && (
              <select
                className="input-new"
                style={{ width: 160 }}
                value={etapaFiltro}
                onChange={(e) => setEtapaFiltro(e.target.value)}
                aria-label="Filtrar por etapa"
              >
                <option value="">Todas las etapas</option>
                {CRM_ETAPAS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            )}

            {socios.length > 0 && (
              <select
                className="input-new"
                style={{ width: 190 }}
                value={origen}
                onChange={(e) => setOrigen(e.target.value)}
                aria-label="Filtrar por quién lo agregó"
              >
                <option value="">Lo agregó cualquiera</option>
                <option value={ORIGEN_DALECONTROL}>Sólo los míos</option>
                <option value={ORIGEN_AFILIADOS}>De afiliados ({deAfiliados})</option>
                {socios.map(([id, nombre]) => (
                  <option key={id} value={id}>
                    {nombre}
                  </option>
                ))}
              </select>
            )}

            <select
              className="input-new"
              style={{ width: 150 }}
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
              aria-label="Ordenar"
            >
              {ORDENES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSoloPendientes((v) => !v)}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${soloPendientes ? "var(--brand)" : "var(--border-soft)"}`,
                background: soloPendientes ? "var(--brand-soft)" : "var(--bg-elev)",
                color: soloPendientes ? "var(--text-1)" : "var(--text-2)",
              }}
              aria-pressed={soloPendientes}
            >
              Sólo pendientes
            </button>

            <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
              <BotonVista actual={vista} valor="tablero" icono={<LayoutGrid size={13} />} label="Tablero" alElegir={setVista} />
              <BotonVista actual={vista} valor="lista" icono={<List size={13} />} label="Lista" alElegir={setVista} />
            </div>
          </div>

          {/* ── Embudo ─────────────────────────────────────────────── */}
          {vista === "tablero" ? (
            <CrmTablero
              filas={filtradas}
              ahora={ahora}
              mover={(id, etapa) => mover(id, etapa)}
              alVerLista={(etapa) => {
                setEtapaFiltro(etapa);
                setVista("lista");
              }}
            />
          ) : (
            <CardNew noPad title={`Prospectos (${filtradas.length})`}>
              <CrmLista filas={filtradas} ahora={ahora} mover={(id, etapa) => mover(id, etapa)} />
            </CardNew>
          )}

          <p style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 12, maxWidth: 760 }}>
            {listado.truncado
              ? `Se muestran los ${filas.length} prospectos más recientes de ${listado.total}. `
              : ""}
            Los botones de WhatsApp y llamar abren la app en este equipo y dejan la constancia en
            la bitácora del prospecto: DaleControl no manda nada por su cuenta desde aquí.
          </p>
        </>
      )}

      {creando && (
        <CrmFormulario
          alCerrar={() => setCreando(false)}
          alGuardar={() => router.refresh()}
        />
      )}
      {importando && <CrmImportar alCerrar={() => setImportando(false)} />}
      {perdiendo && (
        <CrmMotivoPerdida
          nombre={perdiendo.name}
          alCerrar={() => setPerdiendo(null)}
          alConfirmar={(motivo) => {
            const id = perdiendo.id;
            setPerdiendo(null);
            mover(id, "PERDIDO", motivo);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function BotonVista({
  actual,
  valor,
  icono,
  label,
  alElegir,
}: {
  actual: Vista;
  valor: Vista;
  icono: React.ReactNode;
  label: string;
  alElegir: (v: Vista) => void;
}) {
  const activo = actual === valor;
  return (
    <button
      type="button"
      onClick={() => alElegir(valor)}
      aria-pressed={activo}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 12px",
        borderRadius: 8,
        fontSize: 12,
        cursor: "pointer",
        border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
        background: activo ? "var(--brand-soft)" : "var(--bg-elev)",
        color: activo ? "var(--text-1)" : "var(--text-2)",
      }}
    >
      {icono}
      {label}
    </button>
  );
}

/** Una fila de "hoy toca": lo que se necesita para actuar, y nada más. */
function FilaHoy({
  p,
  ahora,
  alPosponer,
}: {
  p: CrmProspectoDTO;
  ahora: Date;
  alPosponer: (fecha: string | null) => void;
}) {
  const frio = crmEstaFrio(p, ahora);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderTop: "1px solid var(--border-soft)",
        flexWrap: "wrap",
      }}
    >
      <CrmAvatar name={p.name} vertical={p.vertical} size={30} />
      <div style={{ minWidth: 180, flex: "1 1 220px" }}>
        <Link
          href={`/admin/crm/${p.id}`}
          style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}
        >
          {p.name}
        </Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
          <CrmVerticalChip vertical={p.vertical} />
          {p.city && <span style={{ fontSize: 11, color: "var(--text-4)" }}>{p.city}</span>}
          {frio && <span style={{ fontSize: 11, color: "var(--warning)" }}>enfriándose</span>}
        </div>
      </div>

      <div style={{ flex: "1 1 240px", minWidth: 200 }}>
        <CrmSemaforoChip fecha={p.nextActionAt} nota={p.nextActionNote} ahora={ahora} />
      </div>

      <CrmAccionesContacto p={p} soloIconos />

      <div style={{ display: "flex", gap: 4 }}>
        <BotonPosponer label="Mañana" onClick={() => alPosponer(crmDiaRelativo(1, ahora))} />
        <BotonPosponer label="+3 d" onClick={() => alPosponer(crmDiaRelativo(3, ahora))} />
        <BotonPosponer label="+1 sem" onClick={() => alPosponer(crmDiaRelativo(7, ahora))} />
        <BotonPosponer label="Listo" onClick={() => alPosponer(null)} />
      </div>
    </div>
  );
}

function BotonPosponer({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        padding: "0 9px",
        borderRadius: 7,
        border: "1px solid var(--border-soft)",
        background: "var(--bg-elev-2)",
        color: "var(--text-3)",
        fontSize: 11,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title={label === "Listo" ? "Quitarle el próximo paso" : `Posponer a ${label}`}
    >
      {label}
    </button>
  );
}

/** Lo que se ve el primer día, cuando la libreta está vacía. */
function VacioInicial({ alCrear, alImportar }: { alCrear: () => void; alImportar: () => void }) {
  return (
    <CardNew>
      <div style={{ padding: "36px 20px", textAlign: "center", maxWidth: 620, margin: "0 auto" }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            margin: "0 auto 14px",
            display: "grid",
            placeItems: "center",
            background: "var(--brand-soft)",
            color: "var(--brand)",
          }}
        >
          <Target size={22} />
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
          Todavía no hay ningún prospecto
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "8px 0 18px", lineHeight: 1.55 }}>
          Empieza por las clínicas dentales que ya tienes vistas. Puedes darlas de alta una por
          una, o pegar una lista completa —de una hoja de cálculo o de una búsqueda en Google
          Maps— y darlas de alta todas de golpe.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <ButtonNew variant="primary" icon={<Plus size={13} />} onClick={alCrear}>
            Agregar el primero
          </ButtonNew>
          <ButtonNew variant="secondary" icon={<Upload size={13} />} onClick={alImportar}>
            Pegar una lista
          </ButtonNew>
        </div>
      </div>
    </CardNew>
  );
}
