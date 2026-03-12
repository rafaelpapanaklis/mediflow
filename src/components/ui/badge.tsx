import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors", {
  variants: {
    variant: {
      default:    "bg-brand-50 text-brand-700 border-brand-200",
      secondary:  "bg-muted text-muted-foreground border-border",
      confirmed:  "bg-emerald-50 text-emerald-700 border-emerald-200",
      pending:    "bg-amber-50 text-amber-700 border-amber-200",
      cancelled:  "bg-rose-50 text-rose-700 border-rose-200",
      paid:       "bg-emerald-50 text-emerald-700 border-emerald-200",
      unpaid:     "bg-amber-50 text-amber-700 border-amber-200",
      partial:    "bg-blue-50 text-blue-700 border-blue-200",
      doctor:     "bg-violet-50 text-violet-700 border-violet-200",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
