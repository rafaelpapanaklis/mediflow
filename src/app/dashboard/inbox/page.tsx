export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { InboxClient } from "./inbox-client";

export const metadata: Metadata = { title: "Inbox — MediFlow" };

export default function InboxPage() {
  return <InboxClient />;
}
