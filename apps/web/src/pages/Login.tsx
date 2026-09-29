import { useEffect, useState } from "react";
import { Coffee, Delete, LogIn } from "lucide-react";
import { api, errorMessage } from "../api";
import { useI18n } from "../i18n";
import type { SessionStaff } from "../session";

interface DirectoryEntry { id: string; name: string; roleLabel: string }

export function Login({ onLogin }: { onLogin: (token: string, staff: SessionStaff) => void }) {
  const [staff, setStaff] = useState<DirectoryEntry[]>([]);
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t, toggle } = useI18n();

  useEffect(() => {
    api<{ data: DirectoryEntry[] }>("/api/v1/auth/staff-directory").then((response) => setStaff(response.data)).catch((reason) => setError(errorMessage(reason)));
  }, []);

  async function submit(value = pin) {
    if (!selected || value.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<{ token: string; staff: SessionStaff }>("/api/v1/auth/login", { method: "POST", body: { staffId: selected.id, pin: value } });
      onLogin(response.token, response.staff);
    } catch (reason) {
      setError(errorMessage(reason));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const press = (digit: string) => setPin((current) => (current.length < 8 ? current + digit : current));

  return <div className="login">
    <div className="login-card">
      <div className="brand big"><span><Coffee size={26} /></span><div><b>CooffeUp</b><small>{t("appSubtitle")}</small></div></div>
      {!selected ? <>
        <h2>{t("whoIsUsing")}</h2>
        <div className="staff-grid">{staff.map((member) => <button key={member.id} onClick={() => setSelected(member)}><b>{member.name}</b><small>{member.roleLabel}</small></button>)}</div>
      </> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <button type="button" className="link" onClick={() => { setSelected(null); setPin(""); setError(""); }}>{t("changeUser")}</button>
        <h2>{selected.name}</h2>
        <label className="sr-only" htmlFor="pin">{t("pin")}</label>
        <input id="pin" className="pin" type="password" inputMode="numeric" autoComplete="current-password" autoFocus value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" />
        <div className="keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button type="button" key={digit} onClick={() => press(digit)}>{digit}</button>)}
          <button type="button" aria-label={t("delete")} onClick={() => setPin((current) => current.slice(0, -1))}><Delete size={18} /></button>
          <button type="button" onClick={() => press("0")}>0</button>
          <button type="submit" className="primary" disabled={busy || pin.length < 4} aria-label={t("signIn")}><LogIn size={18} /></button>
        </div>
      </form>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="button" className="link" onClick={toggle}>{t("language")}</button>
    </div>
  </div>;
}
