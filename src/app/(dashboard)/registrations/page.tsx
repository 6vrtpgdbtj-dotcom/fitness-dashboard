import {
  ServerDashboardPage,
  type DashboardSearch,
} from "@/components/dashboard/server-page";
export default function RegistrationsPage({
  searchParams,
}: {
  searchParams: DashboardSearch;
}) {
  return (
    <ServerDashboardPage searchParams={searchParams} kind="registrations" />
  );
}
