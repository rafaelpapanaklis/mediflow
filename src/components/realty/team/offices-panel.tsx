"use client";

import { useState } from "react";
import {
  Building2,
  Crown,
  Map as MapIcon,
  Pencil,
  Plus,
  Store,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { RealtyOfficeRow, RealtyOfficesOverview } from "@/lib/realty/offices";
import { formatRealtyPrice } from "@/lib/realty/plan-shared";
import {
  apiCall,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  Kpi,
  Modal,
  plural,
  styles as s,
  SwitchRow,
  TextInput,
  useSaving,
} from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// OFICINAS — alta con dirección y mapa, vista consolidada y por sede.
//
// El acceso de cada persona a cada oficina se reparte desde la pestaña de
// Personas (es una llave de sede, no un dato de la oficina).
//
// 🔴 Los inmuebles SIN oficina se cuentan aparte, no se esconden: un filtro
// por lista de oficinas los descarta en silencio y la suma por sede dejaría
// de cuadrar con la cartera total.
// ═══════════════════════════════════════════════════════════════════════

type Draft = {
  id: string | null;
  name: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  isMain: boolean;
  isActive: boolean;
};

function emptyDraft(): Draft {
  return { id: null, name: "", address: "", lat: "", lng: "", phone: "", isMain: false, isActive: true };
}

function toDraft(o: RealtyOfficeRow): Draft {
  return {
    id: o.id,
    name: o.name,
    address: o.address ?? "",
    lat: o.lat === null ? "" : String(o.lat),
    lng: o.lng === null ? "" : String(o.lng),
    phone: o.phone ?? "",
    isMain: o.isMain,
    isActive: o.isActive,
  };
}

export function OfficesPanel({
  initial,
  canManage,
}: {
  initial: RealtyOfficesOverview;
  canManage: boolean;
}) {
  const [data, setData] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<RealtyOfficeRow | null>(null);
  const { saving, error, setError, run } = useSaving();

  const limit = data.limit;

  async function save() {
    if (!draft) return;
    const ok = await run(async () => {
      const body = {
        name: draft.name,
        address: draft.address,
        lat: draft.lat,
        lng: draft.lng,
        phone: draft.phone,
        isMain: draft.isMain,
        isActive: draft.isActive,
      };
      const { offices } = draft.id
        ? await apiCall<{ offices: RealtyOfficeRow[] }>(`/api/realty/offices/${draft.id}`, {
            method: "PATCH",
            json: body,
          })
        : await apiCall<{ offices: RealtyOfficeRow[] }>("/api/realty/offices", {
            method: "POST",
            json: body,
          });
      const fresh = await apiCall<RealtyOfficesOverview>("/api/realty/offices");
      setData({ ...fresh, offices });
    });
    if (ok) setDraft(null);
  }

  async function remove() {
    if (!deleting) return;
    const ok = await run(async () => {
      await apiCall<{ offices: RealtyOfficeRow[] }>(`/api/realty/offices/${deleting.id}`, {
        method: "DELETE",
      });
      setData(await apiCall<RealtyOfficesOverview>("/api/realty/offices"));
    });
    if (ok) setDeleting(null);
  }

  return (
    // 🔴 Los modales van FUERA de .content. Ese div declara container-type, y
    // un container-type convierte a su elemento en bloque contenedor de los
    // position:fixed de dentro: el modal dejaría de anclarse al viewport y
    // saldría a media pantalla, con el fondo oscuro sin cubrir nada.
    <>
      <div className={s.content}>
        <ErrorText>{!draft && !deleting ? error : null}</ErrorText>

        {/* Consolidado */}
        <div className={s.kpis}>
          <Kpi label="Oficinas" value={String(data.offices.length)} hero hint={
            limit.unlimited ? "Sin tope en tu plan" : `${limit.max} en el plan ${limit.planName}`
          } />
          <Kpi label="Inmuebles" value={String(data.totals.properties)} hint={`${data.totals.publishedProperties} publicados`} />
          <Kpi label="Vendidos o rentados" value={String(data.totals.soldOrRented)} />
          <Kpi label="Personas activas" value={String(data.totals.users)} />
        </div>

        {data.unassignedProperties > 0 ? (
          <Banner tone="warn" title="Cartera sin oficina" icon={<TriangleAlert size={16} />}>
            Hay {plural(data.unassignedProperties, "inmueble", "inmuebles")} sin oficina asignada.
            Cuentan en el total y salen en tu web, pero no aparecen en el desglose por sede.
          </Banner>
        ) : null}

        {!limit.featureOn ? (
          <Banner title="Tu plan trabaja con una sola oficina" icon={<Store size={16} />}>
            Con el plan {limit.planName} administras una sede.
            {limit.upgrade
              ? ` Con el plan ${limit.upgrade.name} (${formatRealtyPrice(limit.upgrade.priceMonthly)} al mes) abres las que necesites.`
              : ""}
          </Banner>
        ) : !limit.canCreate ? (
          <Banner tone="warn" title="Ya usaste tus oficinas" icon={<Store size={16} />}>
            Tu plan {limit.planName} permite {plural(limit.max, "oficina", "oficinas")} y ya tienes{" "}
            {limit.used}.
            {limit.upgrade
              ? ` Con el plan ${limit.upgrade.name} (${formatRealtyPrice(limit.upgrade.priceMonthly)} al mes) caben ${
                  limit.upgrade.maxOffices === -1 ? "todas las que necesites" : limit.upgrade.maxOffices
                }.`
              : ""}
          </Banner>
        ) : null}

        <div className={s.header}>
          <div className={s.headerText}>
            <div className={s.sectionTitle}>Tus sedes</div>
          </div>
          {canManage ? (
            <div className={s.headerActions}>
              <Btn variant="primary" onClick={() => setDraft(emptyDraft())} disabled={!limit.canCreate}>
                <Plus size={15} /> Nueva oficina
              </Btn>
            </div>
          ) : null}
        </div>

        {data.offices.length === 0 ? (
          <div className={s.card}>
            <EmptyState
              icon={<Building2 size={22} />}
              title="Todavía no hay oficinas"
              body="La oficina principal nace con tu cuenta. Si no la ves, crea la primera aquí."
            />
          </div>
        ) : (
          <div className={s.grid}>
            {data.offices.map((o) => (
              <article
                key={o.id}
                className={[s.rowCard, o.isActive ? "" : s.rowCardMuted].filter(Boolean).join(" ")}
              >
                <div className={s.avatar}>
                  {o.isMain ? <Crown size={18} /> : <Store size={18} />}
                </div>
                <div className={s.rowMain}>
                  <div className={s.rowTitle}>
                    <span className={s.truncate}>{o.name}</span>
                    {o.isMain ? <Chip tone="brand">Principal</Chip> : null}
                    {!o.isActive ? <Chip tone="muted">Cerrada</Chip> : null}
                  </div>
                  {o.address ? (
                    <div className={s.rowMeta}>
                      <span className={s.truncate}>{o.address}</span>
                    </div>
                  ) : null}
                  <div className={s.rowMeta}>
                    <Chip tone="muted">{plural(o.properties, "inmueble", "inmuebles")}</Chip>
                    <Chip tone="muted">{o.publishedProperties} publicados</Chip>
                    <Chip tone="muted">{plural(o.users, "persona", "personas")}</Chip>
                    {o.phone ? <Chip tone="muted">{o.phone}</Chip> : null}
                  </div>
                  <div className={s.rowActions}>
                    {o.mapsUrl ? (
                      <a
                        href={o.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={[s.btn, s.btnSm].join(" ")}
                      >
                        <MapIcon size={13} /> Ver en el mapa
                      </a>
                    ) : null}
                    {canManage ? (
                      <>
                        <Btn size="sm" onClick={() => setDraft(toDraft(o))}>
                          <Pencil size={13} /> Editar
                        </Btn>
                        {!o.isMain ? (
                          <Btn size="sm" variant="danger" onClick={() => setDeleting(o)}>
                            <Trash2 size={13} /> Borrar
                          </Btn>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Desglose por sede */}
        {data.stats.length > 1 ? (
          <>
            <div className={s.sectionTitle}>Comparativo por sede</div>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Oficina</th>
                    <th className={s.num}>Inmuebles</th>
                    <th className={s.num}>Publicados</th>
                    <th className={s.num}>Cerrados</th>
                    <th className={s.num}>Personas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stats.map((st) => (
                    <tr key={st.officeId ?? "none"}>
                      <td>
                        {st.name}
                        {st.isMain ? " · principal" : ""}
                        {!st.isActive ? " · cerrada" : ""}
                      </td>
                      <td className={s.num}>{st.properties}</td>
                      <td className={s.num}>{st.publishedProperties}</td>
                      <td className={s.num}>{st.soldOrRented}</td>
                      <td className={s.num}>{st.users}</td>
                    </tr>
                  ))}
                  {data.unassignedProperties > 0 ? (
                    <tr>
                      <td style={{ color: "var(--text-3)" }}>Sin oficina asignada</td>
                      <td className={s.num}>{data.unassignedProperties}</td>
                      <td className={s.num}>—</td>
                      <td className={s.num}>—</td>
                      <td className={s.num}>—</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

      </div>

      {draft ? (
        <Modal
          title={draft.id ? `Editar ${draft.name}` : "Nueva oficina"}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label="Nombre" full>
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.name}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Sucursal Providencia"
                />
              )}
            </Field>
            <Field label="Dirección" full>
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.address}
                  maxLength={240}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="Av. Pablo Neruda 2917, Providencia, Guadalajara, Jal."
                />
              )}
            </Field>
            <Field label="Teléfono">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.phone}
                  maxLength={40}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              )}
            </Field>
            <Field label="Latitud" hint="Opcional: para el punto exacto en el mapa.">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.lat}
                  onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                  placeholder="20.6885"
                />
              )}
            </Field>
            <Field label="Longitud">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.lng}
                  onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
                  placeholder="-103.3899"
                />
              )}
            </Field>
          </div>
          <p className={s.hint}>
            Sin coordenadas la liga del mapa se arma con la dirección. Con coordenadas cae en el
            punto exacto — que es lo que le sirve a un cliente que va llegando.
          </p>
          <SwitchRow
            title="Es la oficina principal"
            hint="Solo una. Al marcarla, la anterior deja de serlo."
            checked={draft.isMain}
            onChange={(v) => setDraft({ ...draft, isMain: v })}
            disabled={saving}
          />
          {draft.id ? (
            <SwitchRow
              title="Abierta"
              hint="Cerrarla la saca de los selectores, sin borrar nada."
              checked={draft.isActive}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              disabled={saving || draft.isMain}
            />
          ) : null}
        </Modal>
      ) : null}

      {deleting ? (
        <Modal
          title={`¿Borrar ${deleting.name}?`}
          onClose={() => {
            setDeleting(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setDeleting(null)} disabled={saving}>
                Cancelar
              </Btn>
              <Btn variant="danger" onClick={remove} disabled={saving}>
                {saving ? "Borrando…" : "Borrar la oficina"}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          {deleting.properties > 0 || deleting.users > 0 ? (
            <Banner tone="danger" title="Esta oficina no está vacía" icon={<TriangleAlert size={16} />}>
              Tiene {plural(deleting.properties, "inmueble", "inmuebles")} y{" "}
              {plural(deleting.users, "persona con acceso", "personas con acceso")}. Muévelos a otra
              sede primero, o ciérrala en vez de borrarla: si se borra, esos inmuebles se quedan sin
              oficina y nadie sabría de dónde salieron.
            </Banner>
          ) : (
            <p className={s.hint}>
              Está vacía: no tiene inmuebles ni personas con acceso. Se borra sin dejar nada
              colgando.
            </p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
