import { AnalyticsClient } from "./analytics-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics",
};

export default function AdminAnalyticsPage() {
  return <AnalyticsClient />;
}
