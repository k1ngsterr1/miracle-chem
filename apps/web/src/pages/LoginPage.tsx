import { useState } from "react";
import { Blocks, ChevronRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { apiMutation } from "../api.js";
import type { AuthSession } from "../types.js";

export function LoginPage({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await apiMutation<AuthSession>("/auth/login", { email, password });
      onAuthenticated(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти в систему");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="login-brand"><span><Blocks size={23} /></span><div><strong>MIRACLE CHEM</strong><small>production control</small></div></div>
        <div className="login-message">
          <span className="login-eyebrow">Корпоративная CRM</span>
          <h1>Управление производством</h1>
          <p>Склад · замесы · отгрузки · финансы</p>
        </div>
      </section>

      <section className="login-form-side">
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <div className="login-form-icon"><LockKeyhole size={22} /></div>
          <span className="login-eyebrow">Miracle Chem</span>
          <h2>Вход в систему</h2>
          <p>Введите рабочую почту и пароль.</p>

          <label>
            <span>Электронная почта</span>
            <div className="login-input"><Mail size={17} /><input autoFocus required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@miracle-chem.local" /></div>
          </label>
          <label>
            <span>Пароль</span>
            <div className="login-input"><LockKeyhole size={17} /><input required minLength={8} type={passwordVisible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" /><button type="button" aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </label>

          {error === null ? null : <div className="login-error" role="alert">{error}</div>}
          <button className="login-submit" disabled={submitting}>{submitting ? "Проверяем…" : "Войти"}<ChevronRight size={18} /></button>
        </form>
      </section>
    </main>
  );
}
