"use client";

import {
  ScrollText, Search, ChevronLeft, ChevronRight, X, RotateCcw,
  User as UserIcon, Tag, Clock, Globe,
  Plus, Pencil, Trash, Trash2, Ban, Archive, Eye, KeyRound, FileText, Activity,
} from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import {
  AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, ROLE_OPTIONS, ROLE_LABELS,
  actionMeta, entityLabel, normalizeChanges, formatAuditValue, readInfo, readKindLabel,
  QUICK_RANGE_KEYS, QUICK_RANGE_LABELS, matchQuickRange,
  type QuickRangeKey, type AuditTone, type AuditLogRow,
} from "@/lib/admin/audit-core";
import { RaizPequenas } from "./raiz";
import { Boton, Cabecera, Etiqueta, Modal, TONO_DESDE_SISTEMA, estilos as s } from "./piezas";

/**
 * Bitácora, vestida con el lenguaje del menú de dos niveles.
 *
 * ⛔ Es un registro de AUDITORÍA: no cambia qué se registra ni el orden. Las
 * filas llegan de `AuditoriaClient` (la misma consulta SWR a /api/auditoria
 * de siempre) y se pintan tal cual, una por una, en el orden en que llegan:
 * aquí no hay ni un `sort`, ni un `filter`, ni un `slice` sobre `rows`. Las
 * seis columnas son las mismas seis, en el mismo orden.
 *
 * Los filtros, la búsqueda, la paginación y el detalle también viven en el
 * cliente de siempre; esto pinta y devuelve los mismos eventos. Mismos
 * clics: todos los filtros a la vista, un clic en el usuario o la entidad
 * filtra por ellos, «Ver» abre el detalle.
 */

/** Ícono por acción del catálogo de audit-core (respaldo: Activity). */
const ICONOS_ACCION: Record<string, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  void: Ban,
  soft_delete: Trash,
  archive: Archive,
  view: Eye,
  password_reset: KeyRound,
  XRAY_NOTES_UPDATED: FileText,
  FILE_NOTES_UPDATED: FileText,
};

const CLASE_TONO_ACCION: Record<AuditTone, string> = {
  success: s.accionExito,
  info: s.accionInfo,
  danger: s.accionPeligro,
  warning: s.accionAmbar,
  brand: s.accionVioleta,
  neutral: s.accionNeutra,
};

const RANGO_I18N: Record<QuickRangeKey, string> = {
  today: "auditoria.rangeToday",
  "7d": "auditoria.range7d",
  "30d": "auditoria.range30d",
  "3m": "auditoria.range3m",
};

/** Misma forma que los filtros del cliente de siempre (que no los exporta). */
export interface FiltrosBitacora {
  role: string; action: string; entityType: string;
  userId: string; entityId: string; dateFrom: string; dateTo: string;
}

type Traducir = (k: string, fb: string) => string;

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function CeldaAccion({ action }: { action: string }) {
  const am = actionMeta(action);
  const Icono = ICONOS_ACCION[action] || Activity;
  return (
    <span className={s.accion}>
      <Icono size={16} strokeWidth={1.75} className={CLASE_TONO_ACCION[am.tone]} aria-hidden />
      <Etiqueta tono={TONO_DESDE_SISTEMA[am.tone]}>{am.label}</Etiqueta>
    </span>
  );
}

export function AuditoriaRediseno({
  tr,
  filters,
  patch,
  clearAll,
  qInput,
  setQInput,
  rows,
  total,
  page,
  totalPages,
  setPage,
  isLoading,
  error,
  detail,
  setDetail,
  activeRange,
  applyQuickRange,
  hasActiveFilters,
}: {
  tr: Traducir;
  filters: FiltrosBitacora;
  patch: (p: Partial<FiltrosBitacora>) => void;
  clearAll: () => void;
  qInput: string;
  setQInput: (v: string) => void;
  rows: AuditLogRow[];
  total: number;
  page: number;
  totalPages: number;
  setPage: (n: number) => void;
  isLoading: boolean;
  error: unknown;
  detail: AuditLogRow | null;
  setDetail: (r: AuditLogRow | null) => void;
  activeRange: ReturnType<typeof matchQuickRange>;
  applyQuickRange: (k: QuickRangeKey) => void;
  hasActiveFilters: boolean;
}) {
  return (
    <RaizPequenas>
      <Cabecera
        icono={<ScrollText size={18} strokeWidth={1.75} />}
        titulo={tr("auditoria.title", "Bitácora de actividad")}
        subtitulo={tr("auditoria.subtitleClinic", "Quién hizo qué en tu clínica, cuándo y desde dónde.")}
      />

      {/* Filtros: todos a la vista, ninguno detrás de un clic. */}
      <div className={s.filtros}>
        <div className={s.buscador}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={tr("auditoria.searchPlaceholder", "Buscar (ID, IP, navegador)…")}
            aria-label={tr("auditoria.search", "Búsqueda libre")}
          />
        </div>
        <select className={s.entrada} value={filters.role} onChange={(e) => patch({ role: e.target.value })} aria-label={tr("auditoria.role", "Rol")}>
          <option value="">{tr("auditoria.allRoles", "Todos los roles")}</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
        </select>
        <select className={s.entrada} value={filters.action} onChange={(e) => patch({ action: e.target.value })} aria-label={tr("auditoria.action", "Acción")}>
          <option value="">{tr("auditoria.allActions", "Todas las acciones")}</option>
          {AUDIT_ACTION_OPTIONS.map((a) => <option key={a} value={a}>{actionMeta(a).label}</option>)}
        </select>
        <select className={s.entrada} value={filters.entityType} onChange={(e) => patch({ entityType: e.target.value })} aria-label={tr("auditoria.entity", "Entidad")}>
          <option value="">{tr("auditoria.allEntities", "Todas las entidades")}</option>
          {AUDIT_ENTITY_OPTIONS.map((en) => <option key={en} value={en}>{entityLabel(en)}</option>)}
        </select>
        <input type="date" className={s.entrada} value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} aria-label={tr("auditoria.dateFrom", "Fecha desde")} />
        <input type="date" className={s.entrada} value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} aria-label={tr("auditoria.dateTo", "Fecha hasta")} />
        <div className={s.segmento} role="group" aria-label={tr("auditoria.quickRange", "Rango rápido")}>
          {QUICK_RANGE_KEYS.map((k) => {
            const activo = activeRange === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={activo}
                onClick={() => applyQuickRange(k)}
                className={`${s.segmentoBoton} ${activo ? s.segmentoActivo : ""}`.trim()}
              >
                {tr(RANGO_I18N[k], QUICK_RANGE_LABELS[k])}
              </button>
            );
          })}
        </div>
        {hasActiveFilters && (
          <Boton suave peq onClick={clearAll}>
            <RotateCcw size={15} strokeWidth={1.75} aria-hidden /> {tr("auditoria.clear", "Limpiar")}
          </Boton>
        )}
      </div>

      {(filters.userId || filters.entityId) && (
        <div className={s.chips}>
          {filters.userId && <Chip label={`${tr("auditoria.user", "Usuario")}: ${filters.userId}`} onQuitar={() => patch({ userId: "" })} />}
          {filters.entityId && <Chip label={`${tr("auditoria.entity", "Entidad")}: ${filters.entityId}`} onQuitar={() => patch({ entityId: "" })} />}
        </div>
      )}

      {/* La tabla: seis columnas, mismo orden que hoy. Si no cabe, se desliza. */}
      <div className={s.tarjeta}>
        <div className={s.tablaEnvoltura}>
          <table className={s.tabla}>
            <thead>
              <tr>
                <th>{tr("auditoria.colDate", "Fecha")}</th>
                <th>{tr("auditoria.colUser", "Usuario")}</th>
                <th>{tr("auditoria.colAction", "Acción")}</th>
                <th>{tr("auditoria.colEntity", "Entidad")}</th>
                <th>{tr("auditoria.colIp", "IP")}</th>
                <th className={s.derecha}>{tr("auditoria.colDetail", "Detalle")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${s.sinSalto} ${s.discreto}`}>{fmtFechaHora(r.createdAt)}</td>
                  <td>
                    <button type="button" onClick={() => patch({ userId: r.userId })} title={tr("auditoria.filterByUser", "Filtrar por este usuario")} className={s.filaBoton}>
                      <AvatarNew name={r.userName} size="sm" />
                      <span className={s.celdaTextos}>
                        <span className={`${s.negrita} ${s.rompe}`}>{r.userName}</span>
                        {r.userRole && <span className={`${s.peq} ${s.discreto}`}>{ROLE_LABELS[r.userRole] ?? r.userRole}</span>}
                      </span>
                    </button>
                  </td>
                  <td>
                    <CeldaAccion action={r.action} />
                    <Lectura changes={r.changes} tr={tr} />
                  </td>
                  <td>
                    <button type="button" onClick={() => patch({ entityId: r.entityId })} title={tr("auditoria.filterByEntity", "Filtrar por esta entidad")} className={s.filaBoton}>
                      <span className={s.celdaTextos}>
                        <span className={s.secundario}>{entityLabel(r.entityType)}</span>
                        <span className={s.identificador}>{r.entityId}</span>
                      </span>
                    </button>
                  </td>
                  <td className={`${s.sinSalto} ${s.discreto} ${s.peq}`}>{r.ipAddress ?? "—"}</td>
                  <td className={s.derecha}>
                    <Boton peq onClick={() => setDetail(r)}>{tr("auditoria.view", "Ver")}</Boton>
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className={s.tablaVacio}>
                    <ScrollText size={20} strokeWidth={1.75} aria-hidden />
                    <span>
                      {error ? tr("auditoria.loadError", "No se pudo cargar la bitácora.") : tr("auditoria.empty", "Sin eventos para estos filtros.")}
                    </span>
                  </div>
                </td></tr>
              )}
              {isLoading && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className={s.tablaVacio}>{tr("auditoria.loading", "Cargando…")}</div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={s.paginador} style={{ marginTop: 12 }}>
        <div className={s.paginadorInfo}>
          {tr("auditoria.pageOf", "Página")} {page} {tr("auditoria.of", "de")} {totalPages} · {total.toLocaleString("es-MX")} {tr("auditoria.events", "eventos")}
        </div>
        <div className={s.paginadorBotones}>
          <Boton peq disabled={page <= 1 || isLoading} onClick={() => setPage(Math.max(1, page - 1))}>
            <ChevronLeft size={15} strokeWidth={1.75} aria-hidden /> {tr("auditoria.prev", "Anterior")}
          </Boton>
          <Boton peq disabled={page >= totalPages || isLoading} onClick={() => setPage(Math.min(totalPages, page + 1))}>
            {tr("auditoria.next", "Siguiente")} <ChevronRight size={15} strokeWidth={1.75} aria-hidden />
          </Boton>
        </div>
      </div>

      {detail && <DetalleEvento row={detail} onCerrar={() => setDetail(null)} tr={tr} />}
    </RaizPequenas>
  );
}

/** Bajo la acción «Lectura»: qué se consultó (ficha, PDF de nota, export). */
function Lectura({ changes, tr }: { changes: unknown; tr: Traducir }) {
  const lectura = readInfo(changes);
  if (!lectura) return null;
  return <div className={`${s.peq} ${s.discreto}`}>{readKindLabel(lectura.kind, tr)}</div>;
}

function Chip({ label, onQuitar }: { label: string; onQuitar: () => void }) {
  return (
    <span className={s.chip}>
      <span>{label}</span>
      <button type="button" onClick={onQuitar} aria-label="Quitar filtro" className={s.chipQuitar}>
        <X size={13} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

function DetalleEvento({ row, onCerrar, tr }: { row: AuditLogRow; onCerrar: () => void; tr: Traducir }) {
  const am = actionMeta(row.action);
  const norm = normalizeChanges(row.changes);
  const lectura = readInfo(row.changes);

  return (
    <Modal
      tituloId="auditoria-detalle-titulo"
      titulo={
        <>
          <Etiqueta tono={TONO_DESDE_SISTEMA[am.tone]}>{am.label}</Etiqueta>
          <span>{entityLabel(row.entityType)}</span>
        </>
      }
      etiquetaCerrar={tr("auditoria.close", "Cerrar")}
      onCerrar={onCerrar}
      ancho
    >
      <div className={s.metas}>
        <Dato icono={Clock} etiqueta={tr("auditoria.colDate", "Fecha")} valor={fmtFechaHora(row.createdAt)} />
        <Dato icono={UserIcon} etiqueta={tr("auditoria.user", "Usuario")} valor={`${row.userName}${row.userRole ? ` · ${ROLE_LABELS[row.userRole] ?? row.userRole}` : ""}`} sub={row.userEmail ?? undefined} />
        <Dato icono={Globe} etiqueta={tr("auditoria.colIp", "IP")} valor={row.ipAddress ?? "—"} />
        <Dato icono={Tag} etiqueta={tr("auditoria.entity", "Entidad")} valor={entityLabel(row.entityType)} sub={row.entityId} />
      </div>
      {row.userAgent && (
        <div className={`${s.peq} ${s.discreto} ${s.rompe}`}>
          <span className={s.negrita}>{tr("auditoria.browser", "Navegador")}:</span> {row.userAgent}
        </div>
      )}

      {lectura ? (
        <div>
          <h4 className={s.seccionTitulo}>{tr("auditoria.readTitle", "Qué se consultó")}</h4>
          <div className={s.peq}>{readKindLabel(lectura.kind, tr)}</div>
          {lectura.recordId && (
            <div className={`${s.peq} ${s.discreto} ${s.rompe}`}>
              <span className={s.negrita}>{tr("auditoria.readNoteId", "Nota")}:</span> {lectura.recordId}
            </div>
          )}
          <div className={`${s.peq} ${s.discreto}`}>{tr("auditoria.readNoContent", "Una consulta no modifica nada. La bitácora guarda quién y cuándo, no el contenido.")}</div>
        </div>
      ) : (
      <div>
        <h4 className={s.seccionTitulo}>
          {norm.kind === "created" ? tr("auditoria.created", "Datos creados")
            : norm.kind === "deleted" ? tr("auditoria.deleted", "Datos eliminados")
            : norm.kind === "updated" ? tr("auditoria.updated", "Campos modificados")
            : tr("auditoria.changes", "Cambios")}
        </h4>
        {norm.fields.length === 0 ? (
          <div className={`${s.peq} ${s.discreto}`}>{tr("auditoria.noChanges", "Sin detalle de cambios registrado.")}</div>
        ) : (
          <div className={s.tablaMarco}>
            <table className={`${s.tabla} ${s.tablaArriba}`}>
              <thead>
                <tr>
                  <th>{tr("auditoria.field", "Campo")}</th>
                  <th>{tr("auditoria.before", "Antes")}</th>
                  <th>{tr("auditoria.after", "Después")}</th>
                </tr>
              </thead>
              <tbody>
                {norm.fields.map((f) => (
                  <tr key={f.field}>
                    <td className={`${s.negrita} ${s.sinSalto}`}>{f.field}</td>
                    <td className={`${s.anchoMax} ${s.rompe} ${s.discreto}`}>{formatAuditValue(f.before)}</td>
                    <td className={`${s.anchoMax} ${s.rompe} ${norm.kind === "deleted" ? s.discreto : ""}`.trim()}>{formatAuditValue(f.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </Modal>
  );
}

function Dato({ icono: Icono, etiqueta, valor, sub }: {
  icono: typeof Clock; etiqueta: string; valor: string; sub?: string;
}) {
  return (
    <div className={s.meta}>
      <Icono size={16} strokeWidth={1.75} aria-hidden />
      <div className={s.celdaTextos}>
        <span className={s.metaEtiqueta}>{etiqueta}</span>
        {/* IP y entityId en Instrument Sans con cifras tabulares, como todo el
            panel con el interruptor encendido: son datos que se leen. */}
        <span className={s.metaValor}>{valor}</span>
        {sub && <span className={s.metaSub}>{sub}</span>}
      </div>
    </div>
  );
}
