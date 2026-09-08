import {
  ServerDashboardPage,
  type DashboardSearch,
} from "@/components/dashboard/server-page";
export default function ClassesPage({
  searchParams,
}: {
  searchParams: DashboardSearch;
}) {
  return <ServerDashboardPage searchParams={searchParams} kind="classes" />;
}
