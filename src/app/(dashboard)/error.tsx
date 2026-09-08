"use client";
import { DashboardError } from "@/components/dashboard/dashboard-states";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <DashboardError retry={reset} />
    </main>
  );
}
