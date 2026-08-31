"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Settings2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_AI_FEATURE_DESCRIPTIONS,
  EDU_ROLE_LABELS,
  type EduRole,
} from "@/lib/edu/types";
import {
  eduIaCentsToMicros,
  eduIaEnExcedente,
  eduIaIncluidoUsdMicros,
  eduIaMarcaIncluido,
  eduIaPorcentajeUsado,
  eduIaPrecioLabel,
  eduIaRestanteUsdMicros,
  eduIaTechoUsdMicros,
  eduIaUsdInputValue,
  eduIaUsdLabel,
  type EduIaCupo,
  type EduIaEstado,
  type EduIaPanel,
} from "@/lib/edu/ia-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/ia — EL CUPO DE IA DEL INSTITUTO.
 *
 * MÓVIL PRIMERO, como todo el panel: la dirección abre esto desde el
 * teléfono cuando un docente le escribe "a mis alumnos no les funciona el
 * micrófono".
 *
 * 🔴 LO QUE ESTA PANTALLA NO HACE, Y ES LO MÁS IMPORTANTE DE ELLA:
 *
 *   · NO deja editar el cupo que INCLUYE el contrato. Lo pinta, dice de
 *     dónde viene y hasta cuándo vale. Subirlo es cambiar el contrato, y
 *     la cuenta de API que se consume es la de DaleControl — un campo aquí
 *     convertiría "lo que incluye tu contrato" en "lo que alguien tecleó".
 *     El servidor lo rechaza además de que no exista el campo: una
 *     validación que solo vive en el formulario no es una validación.
 *   · NO calcula nada de dinero. Todos los importes, porcentajes y
 *     etiquetas vienen resueltos del servidor (ia-cupo.ts) o de las
 *     funciones puras de ia-core.ts. Aquí no hay ni un número de precio
 *     escrito: las tarifas se LEEN de la tabla y se pintan tal cual.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduIaScreenProps {
  panel: EduIaPanel & { mesAnteriorLabel: string; mesAnteriorCostLabel: string };
  /** Hasta cuándo vale el contrato del instituto, ya formateado. */
  contratoHasta: string;
}

const TAG_BY_MOTIVO: Record<string, string> = {
  ok: "edu-tag--ok",
  cupo_agotado: "edu-tag--danger",
  sin_cupo: "edu-tag--warn",
  apagada: "edu-tag--muted",
  sin_precio: "edu-tag--warn",
  sin_llave: "edu-tag--warn",
  suspendida: "edu-tag--danger",
};

export function EduIaScreen({ panel, contratoHasta }: EduIaScreenProps) {
  const [editando, setEditando] = useState(false);
  const { cupo } = panel;

  return (
    <div className="edu-stack">
      {/* ── 1. El cupo del mes ───────────────────────────────────────── */}
      {!cupo ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Tu contrato todavía no incluye cupo de IA</p>
          <p className="edu-empty__detail">
            El dictado por voz y el análisis radiográfico están construidos y probados, pero
            consumen tokens que cuestan dinero y hace falta un cupo mensual al que cargarlos. No se
            enciende con una casilla: es un renglón del contrato. Pídeselo a DaleControl y en
            cuanto esté, el micrófono y el análisis funcionan sin tocar nada más.
          </p>
        </div>
      ) : (
        <CupoCard
          cupo={cupo}
          contratoHasta={contratoHasta}
          mesAnteriorLabel={panel.mesAnteriorLabel}
          mesAnteriorCostLabel={panel.mesAnteriorCostLabel}
          puedeEditar={panel.puedeEditar}
          onEditar={() => setEditando(true)}
        />
      )}

      {/* ── 2. Cómo está cada función ────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Las dos funciones</h2>
            <p className="edu-section__lead">
              Si alguna está apagada, aquí dice exactamente por qué y qué hay que hacer.
            </p>
          </div>
        </div>

        <div className="edu-stack edu-stack--tight">
          {panel.estados.map((e) => (
            <FuncionCard key={e.feature} estado={e} />
          ))}
        </div>
      </section>

      {/* ── 3. En qué se fue ─────────────────────────────────────────── */}
      {cupo && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">En qué se fue, por función</h2>
              <p className="edu-section__lead">
                Los totales de {cupo.periodoLabel}. Salen de sumar cada uso: no hay ningún contador
                guardado que se pueda desincronizar.
              </p>
            </div>
          </div>

          {panel.porFuncion.length === 0 ? (
            <p className="edu-note">Todavía nadie ha usado la IA este mes.</p>
          ) : (
            <div className="edu-listas">
              {panel.porFuncion.map((f) => (
                <div key={f.feature} className="edu-lista">
                  <div className="edu-lista__head">
                    <div>
                      <span className="edu-lista__name">{f.featureLabel}</span>
                      <span className="edu-lista__sub">
                        {f.usos} {f.usos === 1 ? "uso" : "usos"} · {f.unidadesLabel}
                      </span>
                    </div>
                    <span className="edu-req__num">{f.costLabel}</span>
                  </div>
                  <div className="edu-progreso" aria-hidden>
                    <span className="edu-progreso__bar" style={{ width: `${f.porcentaje}%` }} />
                  </div>
                  <p className="edu-req__detail">
                    {f.porcentaje} % del gasto del mes. {EDU_AI_FEATURE_DESCRIPTIONS[f.feature]}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 4. Quién lo está usando ──────────────────────────────────── */}
      {cupo && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Quién lo está usando</h2>
              <p className="edu-section__lead">
                Por persona, con el rol que tenía cuando lo usó. Sirve para hablar con alguien, no
                para vigilarlo: la IA está para que la usen.
              </p>
            </div>
          </div>

          {panel.porPersona.length === 0 ? (
            <p className="edu-note">Todavía nadie ha usado la IA este mes.</p>
          ) : (
            <div className="edu-table edu-table--iapersonas">
              <div className="edu-rowhead" aria-hidden="true">
                <span>Persona</span>
                <span>Rol</span>
                <span>Usos</span>
                <span>Gasto</span>
                <span>Parte del mes</span>
              </div>
              {panel.porPersona.map((p) => (
                <div key={`${p.userId ?? "baja"}-${p.userName}`} className="edu-row">
                  <div className="edu-cell edu-cell--wide">
                    <span className="edu-cell__label">Persona</span>
                    <span className="edu-cell__value edu-cell__value--strong">{p.userName}</span>
                    {p.userId === null && (
                      <span className="edu-cell__sub">La cuenta ya no existe</span>
                    )}
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Rol</span>
                    <span className="edu-cell__value">
                      {EDU_ROLE_LABELS[p.userRole as EduRole] ?? p.userRole}
                    </span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Usos</span>
                    <span className="edu-cell__value">{p.usos}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Gasto</span>
                    <span className="edu-cell__value edu-cell__value--strong">{p.costLabel}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Parte del mes</span>
                    <div className="edu-progreso" aria-hidden>
                      <span className="edu-progreso__bar" style={{ width: `${p.porcentaje}%` }} />
                    </div>
                    <span className="edu-cell__sub">{p.porcentaje} %</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 5. Las tarifas, LEÍDAS de la tabla ───────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Las tarifas</h2>
            <p className="edu-section__lead">
              Lo que cobra el proveedor por cada modelo. No hay ningún precio escrito en el
              producto: esta tabla es la única fuente, y si un modelo no está aquí su función se
              apaga en vez de correr sin poder descontarse del cupo.
            </p>
          </div>
        </div>

        {panel.precios.length === 0 ? (
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">No hay ninguna tarifa configurada</p>
              <p className="edu-banner__detail">
                Sin tarifa no se puede saber cuánto cuesta una llamada ni descontarla del cupo, así
                que las dos funciones están apagadas. Le toca a DaleControl darlas de alta.
              </p>
            </div>
          </div>
        ) : (
          <div className="edu-table edu-table--iaprecios">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Función</span>
              <span>Modelo</span>
              <span>Entrada</span>
              <span>Salida</span>
            </div>
            {panel.precios.map((p) => (
              <div key={`${p.feature}-${p.model}`} className="edu-row">
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Función</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    {p.feature === "DICTADO" ? "Dictado por voz" : "Análisis radiográfico"}
                  </span>
                  {p.source && <span className="edu-cell__sub">{p.source}</span>}
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Modelo</span>
                  <span className="edu-cell__value">
                    <code>{p.model}</code>
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Entrada</span>
                  <span className="edu-cell__value">
                    {eduIaPrecioLabel(p.inUsdMicrosPerMillion, p.unit)}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Salida</span>
                  <span className="edu-cell__value">
                    {p.outUsdMicrosPerMillion > 0
                      ? eduIaPrecioLabel(p.outUsdMicrosPerMillion, p.unit)
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 6. El detalle, uso por uso ───────────────────────────────── */}
      {cupo && panel.usos.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Detalle del mes</h2>
              <p className="edu-section__lead">
                Un renglón por uso, del más reciente al más viejo
                {panel.usosTruncados ? " (se muestran los más recientes)" : ""}.
              </p>
            </div>
          </div>

          <div className="edu-table edu-table--iausos">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Cuándo</span>
              <span>Quién</span>
              <span>Función</span>
              <span>Sobre qué</span>
              <span>Consumo</span>
              <span>Costo</span>
            </div>
            {panel.usos.map((u) => (
              <div key={u.id} className="edu-row">
                <div className="edu-cell">
                  <span className="edu-cell__label">Cuándo</span>
                  <span className="edu-cell__value">{u.createdLabel}</span>
                </div>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Quién</span>
                  <span className="edu-cell__value edu-cell__value--strong">{u.userName}</span>
                  <span className="edu-cell__sub">
                    {EDU_ROLE_LABELS[u.userRole as EduRole] ?? u.userRole}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Función</span>
                  <span className="edu-cell__value">{u.featureLabel}</span>
                  <span className="edu-cell__sub">
                    <code>{u.model}</code>
                  </span>
                </div>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Sobre qué</span>
                  <span className="edu-cell__value">{u.targetLabel ?? "—"}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Consumo</span>
                  <span className="edu-cell__value">
                    {u.unit === "TOKEN"
                      ? `${(u.inputUnits + u.outputUnits).toLocaleString("es-MX")} tokens`
                      : `${u.inputUnits} s`}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Costo</span>
                  <span className="edu-cell__value">{u.costLabel}</span>
                  {u.isEstimated && (
                    <span className="edu-cell__sub">
                      Estimado: el proveedor no dijo cuánto consumió
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {editando && cupo && (
        <EditarCupo cupo={cupo} onClose={() => setEditando(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA TARJETA DEL CUPO
// ═══════════════════════════════════════════════════════════════════════

function CupoCard({
  cupo,
  contratoHasta,
  mesAnteriorLabel,
  mesAnteriorCostLabel,
  puedeEditar,
  onEditar,
}: {
  cupo: EduIaCupo;
  contratoHasta: string;
  mesAnteriorLabel: string;
  mesAnteriorCostLabel: string;
  puedeEditar: boolean;
  onEditar: () => void;
}) {
  const techo = eduIaTechoUsdMicros(cupo);
  const restante = eduIaRestanteUsdMicros(cupo);
  const pct = eduIaPorcentajeUsado(cupo);
  const marca = eduIaMarcaIncluido(cupo);
  const excedido = eduIaEnExcedente(cupo);
  const agotado = restante <= 0;

  return (
    <section className={`edu-req ${agotado ? "" : "edu-req--ok"}`}>
      <div className="edu-req__head">
        <span className="edu-req__name">Cupo de {cupo.periodoLabel}</span>
        <span className="edu-req__num">
          {eduIaUsdLabel(cupo.consumidoUsdMicros)} de {eduIaUsdLabel(techo)}
        </span>
      </div>

      {/* La barra, con la MARCA de lo que incluye el contrato cuando hay
          excedente permitido: sin ella, media barra no dice si lo gastado
          ya se salió de lo contratado — que es la única pregunta que la
          barra tenía que contestar. */}
      <div className={`edu-progreso ${agotado ? "edu-progreso--agotado" : ""}`} aria-hidden>
        <span className="edu-progreso__bar" style={{ width: `${pct}%` }} />
        {marca !== null && <span className="edu-progreso__meta" style={{ left: `${marca}%` }} />}
      </div>

      <p className="edu-req__detail">
        {agotado ? (
          <>
            <strong>Se acabó el cupo de este mes.</strong> El dictado y el análisis están apagados
            hasta que empiece el mes siguiente.{" "}
            {cupo.permiteExcedente
              ? "Ya se alcanzó el tope que autorizó la dirección."
              : "La dirección puede autorizar gastar de más, con un tope."}
          </>
        ) : (
          <>
            Quedan <strong>{eduIaUsdLabel(restante)}</strong>.{" "}
            {excedido
              ? "Ya se pasó de lo que incluye el contrato: lo que va de más se factura aparte."
              : `Incluidos en el contrato: ${eduIaUsdLabel(eduIaIncluidoUsdMicros(cupo))} al mes.`}
          </>
        )}
      </p>

      <div className="edu-kv">
        <span className="edu-kv__k">Incluye el contrato</span>
        <span className="edu-kv__v">
          {eduIaUsdLabel(eduIaIncluidoUsdMicros(cupo))} al mes · vigente hasta {contratoHasta}
        </span>

        <span className="edu-kv__k">Gastar de más</span>
        <span className="edu-kv__v">
          {cupo.permiteExcedente
            ? `Autorizado, con tope de ${eduIaUsdLabel(eduIaCentsToMicros(cupo.topeUsdCents))}`
            : "No autorizado: al agotarse lo incluido, la IA se apaga"}
        </span>

        <span className="edu-kv__k">Estado</span>
        <span className="edu-kv__v">
          {cupo.encendido ? "Encendida" : "APAGADA por la dirección del instituto"}
        </span>

        <span className="edu-kv__k">{mesAnteriorLabel}</span>
        <span className="edu-kv__v">Se consumieron {mesAnteriorCostLabel}</span>

        {cupo.contacto && (
          <>
            <span className="edu-kv__k">Pedir más cupo</span>
            <span className="edu-kv__v">{cupo.contacto}</span>
          </>
        )}

        {cupo.actualizadoPor && (
          <>
            <span className="edu-kv__k">Último cambio</span>
            <span className="edu-kv__v">
              {cupo.actualizadoPor} · {cupo.actualizadoLabel}
            </span>
          </>
        )}
      </div>

      {puedeEditar && (
        <div className="edu-actions">
          <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={onEditar}>
            <Settings2 size={15} />
            Configurar
          </button>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL ESTADO DE UNA FUNCIÓN
// ═══════════════════════════════════════════════════════════════════════

function FuncionCard({ estado }: { estado: EduIaEstado }) {
  return (
    <article className={`edu-ia__card ${estado.disponible ? "" : "edu-lista--off"}`}>
      <div className="edu-lista__head">
        <div>
          <span className="edu-lista__name">
            {estado.feature === "DICTADO" ? "Dictado por voz" : "Análisis radiográfico con IA"}
          </span>
          <span className="edu-lista__sub">{EDU_AI_FEATURE_DESCRIPTIONS[estado.feature]}</span>
        </div>
        <span className={`edu-tag ${TAG_BY_MOTIVO[estado.motivo] ?? "edu-tag--muted"}`}>
          {estado.disponible ? "Disponible" : "Apagada"}
        </span>
      </div>
      <p className="edu-req__detail">
        <strong>{estado.titulo}.</strong> {estado.detalle}
      </p>
    </article>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL FORMULARIO — solo lo que la ESCUELA decide
// ═══════════════════════════════════════════════════════════════════════

function EditarCupo({ cupo, onClose }: { cupo: EduIaCupo; onClose: () => void }) {
  const router = useRouter();
  const [encendido, setEncendido] = useState(cupo.encendido);
  const [permite, setPermite] = useState(cupo.permiteExcedente);
  const [tope, setTope] = useState(eduIaUsdInputValue(cupo.topeUsdCents));
  const [contacto, setContacto] = useState(cupo.contacto ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/ia", {
        method: "PATCH",
        body: {
          isEnabled: encendido,
          allowOverage: permite,
          hardCapUsdCents: tope.trim() === "" ? null : tope,
          contactNote: contacto.trim() === "" ? null : contacto,
        },
      });
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Configurar el cupo de IA"
      subtitle="Lo que decide el instituto. Lo que incluye el contrato se cambia con DaleControl."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {/* 🔴 Lo incluido se PINTA, no se edita. Está aquí arriba a propósito:
          quien abre este modal buscando subir su cupo tiene que leer por qué
          no puede antes de rellenar nada. */}
      <div className="edu-banner">
        <div>
          <p className="edu-banner__title">
            Tu contrato incluye {eduIaUsdLabel(eduIaIncluidoUsdMicros(cupo))} de IA al mes
          </p>
          <p className="edu-banner__detail">
            Eso no se edita desde aquí: es un renglón del contrato y el gasto va a la cuenta de API
            de DaleControl. Para ampliarlo, habla con DaleControl. Lo que sí decides en esta
            pantalla es si se puede gastar de más de ese cupo, hasta cuánto, y si hoy quieres la IA
            encendida.
          </p>
        </div>
      </div>

      <label className="edu-check">
        <input
          type="checkbox"
          checked={encendido}
          onChange={(e) => setEncendido(e.target.checked)}
          disabled={busy}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">La IA está encendida</span>
          <span className="edu-check__hint">
            Apagarla no borra el cupo ni lo consumido: deja el micrófono y el análisis
            deshabilitados, diciendo que fue la dirección quien los apagó.
          </span>
        </span>
      </label>

      <label className="edu-check">
        <input
          type="checkbox"
          checked={permite}
          onChange={(e) => setPermite(e.target.checked)}
          disabled={busy}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Permitir gastar de más del cupo incluido</span>
          <span className="edu-check__hint">
            Sin esto, al agotarse lo incluido la IA se apaga hasta el mes siguiente. Con esto, se
            sigue usando hasta el tope de abajo y lo que pase del cupo se factura aparte.
          </span>
        </span>
      </label>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-ia-tope">
          Tope duro del mes (USD)
        </label>
        <input
          id="edu-ia-tope"
          className="edu-input"
          inputMode="decimal"
          value={tope}
          onChange={(e) => setTope(e.target.value)}
          disabled={busy || !permite}
          placeholder="Por ejemplo 120.00"
          autoComplete="off"
        />
        <span className="edu-field__hint">
          Obligatorio si permites gastar de más, y tiene que ser MAYOR que lo que incluye tu
          contrato. Es el total del mes, no lo que se añade: al llegar aquí, la IA se apaga aunque
          esté autorizado el excedente.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-ia-contacto">
          A quién pedirle más cupo
        </label>
        <input
          id="edu-ia-contacto"
          className="edu-input"
          value={contacto}
          maxLength={300}
          onChange={(e) => setContacto(e.target.value)}
          disabled={busy}
          placeholder="Coordinación académica, ext. 214"
          autoComplete="off"
        />
        <span className="edu-field__hint">
          Se le enseña al alumno DENTRO del mensaje de &quot;se acabó el cupo&quot;. Un alumno con el
          micrófono muerto y sin saber a quién preguntarle abre un ticket.
        </span>
      </div>

      <p className="edu-note">
        <AlertTriangle size={14} aria-hidden /> Quede quien quede en el formulario, el servidor
        vuelve a comprobar las tres reglas: no se puede tocar lo incluido, permitir excedente exige
        tope, y el tope tiene que ser mayor que lo incluido.
      </p>
    </EduModal>
  );
}
