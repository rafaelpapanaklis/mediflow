"use client";

import type { AnchorHTMLAttributes } from "react";
import { trackGa4SelectPromotion } from "@/lib/analytics/ga4";

// Botón del anuncio del blog. Es un <a> real (funciona sin JS); el onClick solo
// suma el evento `select_promotion` de GA4, sin tocar las conversiones de Ads.
export function AnuncioLink({
  promotionId,
  children,
  ...rest
}: { promotionId: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      className="blog-ad__cta"
      onClick={(e) => {
        rest.onClick?.(e);
        trackGa4SelectPromotion(promotionId);
      }}
    >
      {children}
    </a>
  );
}
