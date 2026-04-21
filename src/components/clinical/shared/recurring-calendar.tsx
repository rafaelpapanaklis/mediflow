"use client";

import { formatRelativeDate } from "@/lib/format";

interface CalendarItem {
  date: string;
  title: string;
  category: string;
  color: string;
  completed?: boolean;
}

interface RecurringCalendarProps {
  items: CalendarItem[];
  title?: string;
  emptyMessage?: string;
}

export function RecurringCalendar({
  items,
  title = "Próximas sesiones",
  emptyMessage = "Sin sesiones próximas",
}: RecurringCalendarProps) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-1)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>

      {items.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-2)",
            padding: "24px 0",
          }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 0",
                borderBottom:
                  i < items.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: item.color,
                  boxShadow: `0 0 8px ${item.color}`,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  color: "var(--text-1)",
                  textDecoration: item.completed ? "line-through" : "none",
                  opacity: item.completed ? 0.5 : 1,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </div>
              {item.category && (
                <span className="tag-new" style={{ flexShrink: 0 }}>
                  {item.category}
                </span>
              )}
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 10,
                  color: "var(--text-2)",
                  flexShrink: 0,
                }}
              >
                {formatRelativeDate(item.date)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
