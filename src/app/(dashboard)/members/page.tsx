import {
  ServerDashboardPage,
  type DashboardSearch,
} from "@/components/dashboard/server-page";
export default function MembersPage({
  searchParams,
}: {
  searchParams: DashboardSearch;
}) {
  return <ServerDashboardPage searchParams={searchParams} kind="members" />;
}
