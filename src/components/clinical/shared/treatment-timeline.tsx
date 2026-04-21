"use client";

import { useState } from "react";

interface Milestone {
  date: string;
  title: string;
  image?: string;
  status: "completed" | "current" | "pending";
  notes?: string;
}

interface TreatmentTimelineProps {
  milestones: Milestone[];
  currentIndex?: number;
}

function dotColor(status: Milestone["status"]): string {
  if (status === "completed") return "#34d399";
  if (status === "current") return "#7c3aed";
  return "var(--border)";
}

export function TreatmentTimeline({
  milestones,
  currentIndex,
}: TreatmentTimelineProps) {
  const [expanded, setExpanded] = useState<number | null>(
    typeof currentIndex === "number" ? currentIndex : null
  );

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          paddingBottom: 8,
          position: "relative",
        }}
      >
        {milestones.map((m, i) => {
          const color = dotColor(m.status);
          const isExpanded = expanded === i;
          const glow = m.status === "current" ? "0 0 12px #7c3aed" : "none";
          return (
            <div
              key={i}
              onClick={() => setExpanded(isExpanded ? null : i)}
              style={{
                flex: "0 0 140px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                position: "relative",
              }}
            >
              {i < milestones.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    left: "calc(50% + 8px)",
                    right: "calc(-50% + 8px)",
                    height: 1,
                    background: "var(--border)",
                  }}
                />
              )}
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 12,
                  background: color,
                  boxShadow: glow,
                  position: "relative",
                  zIndex: 1,
                }}
              />
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "ui-monospace, monospace",
                  color: "var(--text-2)",
                }}
              >
                {m.date}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-1)",
                  textAlign: "center",
                  lineHeight: 1.3,
                }}
              >
                {m.title}
              </div>
              {m.image && (
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 6,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                  }}
                >
                  <img
                    src={m.image}
                    alt={m.title}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {expanded !== null && milestones[expanded]?.notes && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-1)",
              fontWeight: 500,
              marginBottom: 4,
            }}
          >
            {milestones[expanded].title}
          </div>
          {milestones[expanded].notes}
        </div>
      )}
    </div>
  );
}
