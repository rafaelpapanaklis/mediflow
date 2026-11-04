import { AnalyticsClient } from "./analytics-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics",
};

export default async function AdminAnalyticsPage() {
  await requireAdminPage();
  return <AnalyticsClient />;
}
