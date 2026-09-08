import {
  ServerDashboardPage,
  type DashboardSearch,
} from "@/components/dashboard/server-page";
export default function LeadsPage({
  searchParams,
}: {
  searchParams: DashboardSearch;
}) {
  return <ServerDashboardPage searchParams={searchParams} kind="leads" />;
}
