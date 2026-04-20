import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
  noPad?: boolean;
  className?: string;
};

export function CardNew({ title, sub, action, children, noPad, className }: CardProps) {
  const cls = ["card", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {(title || action) && (
        <div className="card__header">
          <div>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? "" : "card__body"}>{children}</div>
    </div>
  );
}
