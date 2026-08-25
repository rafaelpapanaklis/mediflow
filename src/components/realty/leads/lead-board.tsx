"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Building2, Phone, User } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  canTransition,
  REALTY_LEAD_FLOW,
  REALTY_LEAD_STAGE_UI,
  type RealtyLeadStage,
} from "@/lib/realty/types";
import type { RealtyLeadCardDTO } from "@/lib/realty/leads";
import {
  budgetRange,
  contactHeat,
  heatLabel,
  initials,
  prettyPhone,
  sourceLabel,
  type RealtyTone,
} from "./lead-ui";
import { Chip, HeatBadge } from "./lead-bits";

/** Las seis del embudo + PERDIDO como séptima columna. */
const COLUMNS: RealtyLeadStage[] = [...REALTY_LEAD_FLOW, "PERDIDO"];

// ── Tarjeta ─────────────────────────────────────────────────────────────

export function LeadCard({
  lead,
  t,
  now,
  dragging,
}: {
  lead: RealtyLeadCardDTO;
  t: TFunction;
  now: number;
  dragging?: boolean;
}) {
  const heat = contactHeat(lead, now);
  const source = sourceLabel(lead.source, lead.portal);

  return (
    <div
      className={dragging ? "lead-card lead-card--dragging" : "lead-card"}
      style={{
        borderLeftColor:
          heat.heat === "ROJO"
            ? "#C62828"
            : heat.heat === "AMARILLO"
              ? "#B26A00"
              : heat.heat === "VERDE"
                ? "#2E7D32"
                : "var(--border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
        <span
          className="lead-truncate"
          style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-1)", minWidth: 0 }}
        >
          {lead.contactName}
        </span>
        {source ? <Chip tone="neutral">{source}</Chip> : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, fontSize: 12, color: "var(--text-2)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Phone size={12} aria-hidden />
          {prettyPhone(lead.contactPhone) ?? t("card.noPhone")}
        </span>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
        {budgetRange(lead.budgetMin, lead.budgetMax, t("card.noBudget"))}
      </div>

      {lead.wants ? (
        <div className="lead-truncate" style={{ fontSize: 12, color: "var(--text-3)" }}>
          {lead.wants}
        </div>
      ) : null}

      {lead.propertyTitle ? (
        <div
          className="lead-truncate"
          style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4 }}
        >
          <Building2 size={12} aria-hidden style={{ flexShrink: 0 }} />
          {lead.propertyTitle}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          paddingTop: 3,
          borderTop: "1px solid var(--border-soft)",
          marginTop: 1,
        }}
      >
        <span
          title={lead.assignedUserName ? t("card.assignedTo", { name: lead.assignedUserName }) : t("card.noAgent")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: lead.assignedUserName ? "var(--text-2)" : "var(--text-4)",
            minWidth: 0,
          }}
        >
          {lead.assignedUserName ? (
            <span
              aria-hidden
              style={{
                width: 19,
                height: 19,
                borderRadius: 999,
                background: "var(--brand-soft)",
                color: "var(--pine-700)",
                display: "grid",
                placeItems: "center",
                fontSize: 9.5,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initials(lead.assignedUserName)}
            </span>
          ) : (
            <User size={13} aria-hidden />
          )}
          <span className="lead-truncate">{lead.assignedUserName ?? t("card.noAgent")}</span>
        </span>

        <HeatBadge
          heat={heat.heat}
          label={heatLabel(heat, t)}
          never={heat.neverContacted && heat.heat !== "NEUTRO"}
          neverLabel={t("heat.neverShort")}
        />
      </div>
    </div>
  );
}

// ── Tarjeta arrastrable ─────────────────────────────────────────────────

function DraggableCard({
  lead,
  t,
  now,
  canDrag,
}: {
  lead: RealtyLeadCardDTO;
  t: TFunction;
  now: number;
  canDrag: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { stage: lead.stage },
    disabled: !canDrag,
  });

  return (
    <div ref={setNodeRef} style={{ position: "relative" }}>
      {/* El arrastre y la navegación son DOS cosas: el bloque arrastrable
          lleva los listeners y el nombre es un enlace de verdad encima, para
          que abrir la ficha con teclado o con clic derecho siga funcionando. */}
      <div
        {...(canDrag ? listeners : {})}
        {...attributes}
        role={canDrag ? "button" : undefined}
        aria-label={canDrag ? `${lead.contactName} — ${t("views.board")}` : undefined}
        style={{ cursor: canDrag ? "grab" : "default" }}
      >
        <LeadCard lead={lead} t={t} now={now} dragging={isDragging} />
      </div>
      <Link
        href={`/inmobiliaria/prospectos/${lead.id}`}
        // Cubre solo la franja del nombre: el resto de la tarjeta queda
        // libre para agarrarla y arrastrarla sin abrir la ficha sin querer.
        style={{ position: "absolute", inset: "6px 44px auto 8px", height: 22, borderRadius: 6 }}
      >
        <span className="lead-sr">{t("actions.open")}</span>
      </Link>
    </div>
  );
}

// ── Columna ─────────────────────────────────────────────────────────────

function Column({
  stage,
  leads,
  t,
  now,
  canDrag,
  activeStage,
}: {
  stage: RealtyLeadStage;
  leads: RealtyLeadCardDTO[];
  t: TFunction;
  now: number;
  canDrag: boolean;
  activeStage: RealtyLeadStage | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const ui = REALTY_LEAD_STAGE_UI[stage];

  // Mientras se arrastra, la columna dice si ACEPTA o no. La regla es la
  // del contrato (canTransition): el tablero no inventa su propio embudo.
  const accepts = activeStage ? activeStage === stage || canTransition(activeStage, stage) : true;
  const blocked = Boolean(activeStage) && !accepts;

  return (
    <section
      ref={setNodeRef}
      className={`lead-col${isOver && accepts ? " lead-col--over" : ""}${isOver && blocked ? " lead-col--blocked" : ""}`}
      aria-label={`${t(`stages.${stage}`)} — ${t("board.count", { count: leads.length })}`}
      style={blocked ? { opacity: 0.55 } : undefined}
    >
      <header className="lead-col__head">
        <Chip tone={ui.tone as RealtyTone}>{t(`stages.${stage}`)}</Chip>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-3)" }}>{leads.length}</span>
      </header>

      <div className="lead-col__stack">
        {leads.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "var(--text-4)", margin: "6px 2px" }}>
            {isOver && accepts ? t("board.dropHere") : blocked ? t("board.blocked") : t("board.empty")}
          </p>
        ) : (
          leads.map((lead) => (
            <DraggableCard key={lead.id} lead={lead} t={t} now={now} canDrag={canDrag} />
          ))
        )}
      </div>
    </section>
  );
}

// ── Tablero ─────────────────────────────────────────────────────────────

export function LeadBoard({
  leads,
  t,
  now,
  canDrag,
  onMove,
}: {
  leads: RealtyLeadCardDTO[];
  t: TFunction;
  now: number;
  canDrag: boolean;
  /** Devuelve false si el movimiento se rechazó (para revertir el optimismo). */
  onMove: (leadId: string, to: RealtyLeadStage) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // PointerSensor con distancia mínima: sin ella, un clic en el enlace del
  // nombre se interpreta como arrastre y la ficha no abre nunca.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const grouped = useMemo(() => {
    const map = new Map<RealtyLeadStage, RealtyLeadCardDTO[]>();
    for (const stage of COLUMNS) map.set(stage, []);
    for (const lead of leads) {
      const bucket = map.get(lead.stage);
      if (bucket) bucket.push(lead);
    }
    return map;
  }, [leads]);

  const active = activeId ? leads.find((l) => l.id === activeId) ?? null : null;

  function handleStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    const to = e.over?.id ? (String(e.over.id) as RealtyLeadStage) : null;
    if (!to) return;
    const leadId = String(e.active.id);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === to) return;
    // Se valida ANTES de pedir nada al servidor: soltar en una columna
    // imposible no debe pintar un error de red, debe no hacer nada.
    if (!canTransition(lead.stage, to)) return;
    onMove(leadId, to);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="lead-board">
        {COLUMNS.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            leads={grouped.get(stage) ?? []}
            t={t}
            now={now}
            canDrag={canDrag}
            activeStage={active?.stage ?? null}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {active ? (
          <div style={{ width: 264, cursor: "grabbing" }}>
            <LeadCard lead={active} t={t} now={now} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
