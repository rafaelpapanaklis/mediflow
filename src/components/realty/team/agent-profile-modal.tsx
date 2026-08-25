"use client";

import { useState } from "react";
import { BadgeCheck, Globe, Info, TriangleAlert } from "lucide-react";
import type {
  RealtyAgentCredentials,
  RealtyAgentSocials,
  RealtyMemberRow,
} from "@/lib/realty/team";
import {
  apiCall,
  Banner,
  Btn,
  ErrorText,
  Field,
  isCredentialExpired,
  Modal,
  Select,
  styles as s,
  SwitchRow,
  TextArea,
  TextInput,
  useSaving,
} from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// FICHA PÚBLICA DEL ASESOR — lo que la web de la inmobiliaria enseña en
// /i/{slug}/agentes/{agente}.
//
// Las credenciales de este mercado son concretas y verificables, así que se
// capturan una por una en vez de dejar un campo de texto libre:
//   · EC0110.02 — el estándar de "Comercialización de servicios
//     inmobiliarios" del CONOCER. Es LO que distingue a un asesor con papel.
//   · AMPI — la asociación; se pone la sección porque es local.
//   · Registro estatal — Jalisco, CDMX, Q. Roo y varios más lo exigen, y
//     VENCE. Por eso lleva fecha y la pantalla avisa cuando ya venció:
//     presumir en la web una licencia caducada es justo lo que un cliente
//     puede comprobar en dos minutos.
//
// DOS interruptores, y los dos tienen que estar arriba para que la ficha se
// vea (así lo fija el schema): el de la CUENTA lo mueve quien administra el
// equipo; el de la FICHA lo mueve el propio asesor cuando la deja a medias.
// ═══════════════════════════════════════════════════════════════════════

const ESTADOS_MX = [
  "AGS", "BC", "BCS", "CAMP", "CHIS", "CHIH", "CDMX", "COAH", "COL", "DGO",
  "GTO", "GRO", "HGO", "JAL", "MEX", "MICH", "MOR", "NAY", "NL", "OAX",
  "PUE", "QRO", "QROO", "SLP", "SIN", "SON", "TAB", "TAMPS", "TLAX", "VER",
  "YUC", "ZAC",
];

type Draft = {
  displayName: string;
  photoUrl: string;
  bio: string;
  zones: string;
  specialties: string;
  publicSlug: string;
  active: boolean;
  publicProfileEnabled: boolean;
  credentials: RealtyAgentCredentials;
  socials: RealtyAgentSocials;
};

function toDraft(member: RealtyMemberRow): Draft {
  const p = member.profile;
  return {
    displayName: p?.displayName ?? member.fullName,
    photoUrl: p?.photoUrl ?? "",
    bio: p?.bio ?? "",
    zones: (p?.zones ?? []).join(", "),
    specialties: (p?.specialties ?? []).join(", "),
    publicSlug: p?.publicSlug ?? "",
    active: p?.active ?? true,
    publicProfileEnabled: member.publicProfileEnabled,
    credentials: p?.credentials ?? {
      ec0110: { has: false, folio: null, issuedAt: null },
      ampi: { member: false, memberId: null, section: null },
      state: { number: null, state: null, expiresAt: null },
      others: [],
    },
    socials: p?.socials ?? {
      facebook: null,
      instagram: null,
      linkedin: null,
      youtube: null,
      tiktok: null,
      website: null,
      whatsapp: null,
    },
  };
}

export function AgentProfileModal({
  member,
  agentPagesEnabled,
  planName,
  onClose,
  onSaved,
}: {
  member: RealtyMemberRow;
  agentPagesEnabled: boolean;
  planName: string;
  onClose: () => void;
  onSaved: (next: RealtyMemberRow) => void;
}) {
  const { saving, error, run } = useSaving();
  const [d, setD] = useState<Draft>(() => toDraft(member));

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setD((prev) => ({ ...prev, [key]: value }));
  }
  function setCred<K extends keyof RealtyAgentCredentials>(
    key: K,
    value: RealtyAgentCredentials[K],
  ) {
    setD((prev) => ({ ...prev, credentials: { ...prev.credentials, [key]: value } }));
  }
  function setSocial(key: keyof RealtyAgentSocials, value: string) {
    setD((prev) => ({ ...prev, socials: { ...prev.socials, [key]: value || null } }));
  }

  const stateExpired = isCredentialExpired(d.credentials.state.expiresAt);
  const visible = d.active && d.publicProfileEnabled && agentPagesEnabled;

  async function save() {
    const ok = await run(async () => {
      // El interruptor de la CUENTA vive en RealtyUser, el de la FICHA en
      // RealtyAgentProfile: son dos endpoints porque son dos permisos.
      const { member: withProfile } = await apiCall<{ member: RealtyMemberRow }>(
        `/api/realty/team/${member.id}/perfil`,
        {
          method: "PUT",
          json: {
            displayName: d.displayName,
            photoUrl: d.photoUrl,
            bio: d.bio,
            zones: d.zones,
            specialties: d.specialties,
            publicSlug: d.publicSlug,
            active: d.active,
            credentials: d.credentials,
            socials: d.socials,
          },
        },
      );
      let next = withProfile;
      if (d.publicProfileEnabled !== member.publicProfileEnabled) {
        const res = await apiCall<{ member: RealtyMemberRow }>(`/api/realty/team/${member.id}`, {
          method: "PATCH",
          json: { publicProfileEnabled: d.publicProfileEnabled },
        });
        next = res.member;
      }
      onSaved(next);
    });
    if (ok) onClose();
  }

  return (
    <Modal
      wide
      title={`Ficha pública de ${member.fullName}`}
      subtitle="Lo que ve un cliente en la página del asesor dentro de tu web."
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar ficha"}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>

      {!agentPagesEnabled ? (
        <Banner tone="warn" title="Tu plan no publica páginas por asesor" icon={<Info size={16} />}>
          Puedes capturar la ficha desde ahora, pero con el plan {planName} no sale en tu web. La
          página por asesor entra con el plan Inmobiliaria.
        </Banner>
      ) : null}

      <div className={s.formGrid}>
        <Field label="Cómo se presenta" full>
          {(id) => (
            <TextInput
              id={id}
              value={d.displayName}
              maxLength={80}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder={member.fullName}
            />
          )}
        </Field>

        <Field label="Foto (liga)" hint="Una liga https a su retrato." full>
          {(id) => (
            <TextInput
              id={id}
              value={d.photoUrl}
              maxLength={200}
              onChange={(e) => set("photoUrl", e.target.value)}
              placeholder="https://…"
            />
          )}
        </Field>

        <Field label="Biografía" hint="Dos o tres líneas. Lo que diría al presentarse." full>
          {(id) => (
            <TextArea
              id={id}
              value={d.bio}
              maxLength={2000}
              rows={4}
              onChange={(e) => set("bio", e.target.value)}
              placeholder="15 años trabajando el poniente de Guadalajara. Especialista en casas para familia y en crédito Infonavit."
            />
          )}
        </Field>

        <Field label="Zonas que domina" hint="Separadas por comas.">
          {(id) => (
            <TextInput
              id={id}
              value={d.zones}
              onChange={(e) => set("zones", e.target.value)}
              placeholder="Providencia, Zapopan centro, Andares"
            />
          )}
        </Field>

        <Field label="Especialidades" hint="Separadas por comas.">
          {(id) => (
            <TextInput
              id={id}
              value={d.specialties}
              onChange={(e) => set("specialties", e.target.value)}
              placeholder="Casas, terrenos, crédito Infonavit"
            />
          )}
        </Field>

        <Field
          label="Dirección de su página"
          hint="Se acomoda sola si choca con la de otro asesor."
          full
        >
          {(id) => (
            <TextInput
              id={id}
              value={d.publicSlug}
              maxLength={80}
              onChange={(e) => set("publicSlug", e.target.value)}
              placeholder="maria-lopez"
            />
          )}
        </Field>
      </div>

      {/* ── Credenciales ── */}
      <div className={s.sectionTitle}>
        <BadgeCheck size={14} /> Credenciales
      </div>

      <SwitchRow
        title="Tiene el estándar EC0110.02"
        hint="Comercialización de servicios inmobiliarios (CONOCER)."
        checked={d.credentials.ec0110.has}
        onChange={(v) => setCred("ec0110", { ...d.credentials.ec0110, has: v })}
        disabled={saving}
      />
      {d.credentials.ec0110.has ? (
        <div className={s.formGrid}>
          <Field label="Folio del certificado">
            {(id) => (
              <TextInput
                id={id}
                value={d.credentials.ec0110.folio ?? ""}
                maxLength={60}
                onChange={(e) => setCred("ec0110", { ...d.credentials.ec0110, folio: e.target.value })}
              />
            )}
          </Field>
          <Field label="Fecha del certificado">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={d.credentials.ec0110.issuedAt ?? ""}
                onChange={(e) =>
                  setCred("ec0110", { ...d.credentials.ec0110, issuedAt: e.target.value })
                }
              />
            )}
          </Field>
        </div>
      ) : null}

      <SwitchRow
        title="Es miembro de AMPI"
        hint="Asociación Mexicana de Profesionales Inmobiliarios."
        checked={d.credentials.ampi.member}
        onChange={(v) => setCred("ampi", { ...d.credentials.ampi, member: v })}
        disabled={saving}
      />
      {d.credentials.ampi.member ? (
        <div className={s.formGrid}>
          <Field label="Número de socio">
            {(id) => (
              <TextInput
                id={id}
                value={d.credentials.ampi.memberId ?? ""}
                maxLength={60}
                onChange={(e) => setCred("ampi", { ...d.credentials.ampi, memberId: e.target.value })}
              />
            )}
          </Field>
          <Field label="Sección">
            {(id) => (
              <TextInput
                id={id}
                value={d.credentials.ampi.section ?? ""}
                maxLength={60}
                onChange={(e) => setCred("ampi", { ...d.credentials.ampi, section: e.target.value })}
                placeholder="Guadalajara"
              />
            )}
          </Field>
        </div>
      ) : null}

      <div className={s.formGrid}>
        <Field label="Registro estatal" hint="El número que da tu estado.">
          {(id) => (
            <TextInput
              id={id}
              value={d.credentials.state.number ?? ""}
              maxLength={60}
              onChange={(e) => setCred("state", { ...d.credentials.state, number: e.target.value })}
            />
          )}
        </Field>
        <Field label="Estado">
          {(id) => (
            <Select
              id={id}
              value={d.credentials.state.state ?? ""}
              onChange={(e) => setCred("state", { ...d.credentials.state, state: e.target.value })}
            >
              <option value="">Sin registro estatal</option>
              {ESTADOS_MX.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Vence el"
          hint="El registro estatal caduca: la web no debe presumir uno vencido."
          full
        >
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={d.credentials.state.expiresAt ?? ""}
              onChange={(e) =>
                setCred("state", { ...d.credentials.state, expiresAt: e.target.value })
              }
            />
          )}
        </Field>
      </div>

      {stateExpired ? (
        <Banner tone="danger" title="Ese registro ya venció" icon={<TriangleAlert size={16} />}>
          El registro estatal caducó el {d.credentials.state.expiresAt}. Renuévalo o quítalo de la
          ficha: es de lo primero que un cliente puede verificar.
        </Banner>
      ) : null}

      {/* ── Redes ── */}
      <div className={s.sectionTitle}>
        <Globe size={14} /> Redes y contacto
      </div>
      <div className={s.formGrid}>
        <Field label="WhatsApp" hint="10 dígitos.">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.whatsapp ?? ""}
              maxLength={20}
              onChange={(e) => setSocial("whatsapp", e.target.value)}
              placeholder="3312345678"
            />
          )}
        </Field>
        <Field label="Sitio web">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.website ?? ""}
              onChange={(e) => setSocial("website", e.target.value)}
              placeholder="https://…"
            />
          )}
        </Field>
        <Field label="Facebook">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.facebook ?? ""}
              onChange={(e) => setSocial("facebook", e.target.value)}
            />
          )}
        </Field>
        <Field label="Instagram">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.instagram ?? ""}
              onChange={(e) => setSocial("instagram", e.target.value)}
            />
          )}
        </Field>
        <Field label="LinkedIn">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.linkedin ?? ""}
              onChange={(e) => setSocial("linkedin", e.target.value)}
            />
          )}
        </Field>
        <Field label="TikTok">
          {(id) => (
            <TextInput
              id={id}
              value={d.socials.tiktok ?? ""}
              onChange={(e) => setSocial("tiktok", e.target.value)}
            />
          )}
        </Field>
      </div>

      {/* ── Los dos interruptores ── */}
      <div className={s.sectionTitle}>Visibilidad</div>
      <SwitchRow
        title="Mostrar en la web"
        hint="El interruptor de la inmobiliaria. Lo mueve quien administra el equipo."
        checked={d.publicProfileEnabled}
        onChange={(v) => set("publicProfileEnabled", v)}
        disabled={saving || !member.active}
      />
      <SwitchRow
        title="La ficha está lista"
        hint="El interruptor del propio asesor, para no salir con la ficha a medias."
        checked={d.active}
        onChange={(v) => set("active", v)}
        disabled={saving}
      />
      <p className={s.hint}>
        {visible
          ? "Con los dos encendidos, su página se ve en tu web pública."
          : !agentPagesEnabled
            ? "Tu plan no publica páginas por asesor todavía."
            : "Los DOS interruptores tienen que estar encendidos para que su página se vea."}
      </p>
    </Modal>
  );
}
