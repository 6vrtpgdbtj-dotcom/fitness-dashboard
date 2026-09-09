import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { AppShell } from "@/components/app-shell";
import { readAdminWorkspace } from "@/features/admin/read-workspace";
import { TrainerForm } from "@/components/users/trainer-form";
import "@/components/review/admin.css";
export default async function UsersPage() {
  if ((await requireUser()).role !== "admin") redirect("/dashboard");
  const data = await readAdminWorkspace();
  return <AppShell role="admin" displayName="관리자" title="사용자 관리"><div className="admin-stack"><div className="admin-intro"><p className="eyebrow">PEOPLE / PERMISSIONS</p><h2>팀의 접근과 담당을 관리하세요.</h2><p>활성화된 트레이너는 자신의 담당 기록만 조회할 수 있습니다.</p></div><TrainerForm trainers={data.trainers} connections={data.connections} /></div></AppShell>;
}
