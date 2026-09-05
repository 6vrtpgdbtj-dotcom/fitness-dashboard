import { signInWithGoogle } from "./actions";
import styles from "./page.module.css";

const errors: Record<string, string> = {
  "not-approved": "접근 권한이 아직 없습니다. 관리자에게 계정 등록 또는 활성화를 요청해 주세요.",
  oauth: "Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.",
  configuration: "로그인 연결을 준비 중입니다. 관리자에게 문의해 주세요.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error && Object.hasOwn(errors, error) ? errors[error] : null;
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <p className="eyebrow">1986 FITNESS · JUNG-SAN</p>
        <h1 id="login-title">우리 팀의 운영 현황을<br />한눈에 확인하세요.</h1>
        <p className={styles.description}>관리자가 등록한 Google 계정으로 로그인해 주세요.</p>
        {message && <p role="alert" className={styles.error}>{message}</p>}
        <form action={signInWithGoogle}>
          <button className={styles.button} type="submit">Google 계정으로 로그인</button>
        </form>
        <p className={styles.note}>담당 회원과 실적은 계정에 지정된 권한에 따라 표시됩니다.</p>
      </section>
    </main>
  );
}
