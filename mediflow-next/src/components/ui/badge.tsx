import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:    "bg-brand-50 text-brand-700 border border-brand-100",
        secondary:  "bg-muted text-muted-foreground border border-border",
        confirmed:  "bg-emerald-50 text-emerald-700 border border-emerald-200",
        pending:    "bg-amber-50 text-amber-700 border border-amber-200",
        progress:   "bg-brand-50 text-brand-700 border border-brand-200",
        cancelled:  "bg-rose-50 text-rose-700 border border-rose-200",
        paid:       "bg-emerald-50 text-emerald-700 border border-emerald-200",
        partial:    "bg-amber-50 text-amber-700 border border-amber-200",
        unpaid:     "bg-rose-50 text-rose-700 border border-rose-200",
        violet:     "bg-violet-50 text-violet-700 border border-violet-200",
        admin:      "bg-amber-50 text-amber-800 border border-amber-200",
        doctor:     "bg-brand-50 text-brand-700 border border-brand-200",
        receptionist: "bg-violet-50 text-violet-700 border border-violet-200",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
