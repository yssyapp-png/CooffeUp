import { useState } from "react";
import { PERMISSION_LABELS, PERMISSIONS, ROLE_PERMISSIONS, SECTOR_PROFILES, type BusinessType, type Permission, type Role } from "@cooffeup/shared";
import { ShieldCheck, UserPlus } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface StaffView { id: string; name: string; role: Role; roleLabel: string; active: boolean; grants: Permission[]; revokes: Permission[]; maxDiscountBps: number; permissions: Permission[]; branchId: string | null }
interface AuditView { id: string; staffId?: string; action: string; targetType?: string; createdAt: string }

export function Staff() {
  const { settings, reloadSettings, branches } = useSession();
  const branchName = (id: string | null) => (id ? branches.find((branch) => branch.id === id)?.name ?? id : "كل الفروع");
  const [version, setVersion] = useState(0);
  const staff = useLoad(() => api<{ data: StaffView[]; roles: Record<Role, string> }>("/api/v1/staff"), [version]);
  const audit = useLoad(() => api<{ data: AuditView[] }>("/api/v1/audit?limit=40"), [version]);
  const [editing, setEditing] = useState<StaffView | null>(null);
  const [form, setForm] = useState({ name: "", role: "cashier" as Role, pin: "", branchId: "" });
  const action = useAction();
  const reload = () => setVersion((value) => value + 1);
  const roles = staff.data?.roles;

  /** Toggling a permission records it as a grant or revoke relative to the member's role defaults. */
  function toggle(member: StaffView, permission: Permission, enabled: boolean) {
    const byRole = ROLE_PERMISSIONS[member.role].includes(permission);
    const grants = member.grants.filter((value) => value !== permission);
    const revokes = member.revokes.filter((value) => value !== permission);
    if (enabled && !byRole) grants.push(permission);
    if (!enabled && byRole) revokes.push(permission);
    const permissions = enabled ? [...member.permissions, permission] : member.permissions.filter((value) => value !== permission);
    setEditing({ ...member, grants, revokes, permissions });
  }

  async function saveMember() {
    if (!editing) return;
    await action.run(() => api(`/api/v1/staff/${editing.id}`, { method: "PATCH", body: { role: editing.role, active: editing.active, grants: editing.grants, revokes: editing.revokes, maxDiscountBps: editing.maxDiscountBps, branchId: editing.branchId } }), "تم حفظ الصلاحيات، وسيُطلب من الموظف تسجيل الدخول من جديد");
    setEditing(null);
    reload();
  }

  return <div className="page">
    <PageHeader eyebrow="صلاحيات دقيقة للبائعين وسجل تدقيق" title="الموظفون والصلاحيات" />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>الموظف</th><th>الدور</th><th>الفرع</th><th>حد الخصم</th><th>الحالة</th><th /></tr></thead>
          <tbody>{(staff.data?.data ?? []).map((member) => <tr key={member.id}>
            <td>{member.name}</td><td>{member.roleLabel}</td><td>{branchName(member.branchId)}</td><td className="num">{member.maxDiscountBps / 100}%</td><td>{member.active ? "نشط" : "موقوف"}</td>
            <td><button className="ghost small" onClick={() => setEditing(member)}><ShieldCheck size={14} /> الصلاحيات</button></td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <div className="stack">
        <form className="card form" onSubmit={async (event) => {
          event.preventDefault();
          const created = await action.run(() => api("/api/v1/staff", { method: "POST", body: { ...form, branchId: form.branchId || undefined } }), "تمت إضافة الموظف");
          if (created) { setForm({ name: "", role: "cashier", pin: "", branchId: "" }); reload(); }
        }}>
          <h3><UserPlus size={16} /> موظف جديد</h3>
          <label>الاسم<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>الدور<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>{roles && Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <label>الفرع<select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
            <option value="">كل الفروع (يختار عند العمل)</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>الرمز السري (4–8 أرقام)<input type="password" inputMode="numeric" pattern="\d{4,8}" required value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} /></label>
          <button className="primary" disabled={action.busy}>إضافة</button>
        </form>
        <div className="card form">
          <h3>نوع النشاط</h3>
          <select value={settings.businessType} onChange={async (event) => { await action.run(() => api("/api/v1/settings", { method: "PATCH", body: { businessType: event.target.value as BusinessType } }), "تم تغيير نوع النشاط"); await reloadSettings(); }}>
            {Object.entries(SECTOR_PROFILES).map(([type, profile]) => <option key={type} value={type}>{profile.nameAr}</option>)}
          </select>
          <small className="muted">يحدد الواجهات المتاحة: الطاولات والمطبخ للمطاعم والمقاهي، المواعيد للصالونات والعيادات والمغاسل، والباركود للتجزئة.</small>
        </div>
      </div>
    </div>

    {editing && <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="perm-title"><div className="dialog wide">
      <h2 id="perm-title">صلاحيات {editing.name}</h2>
      <div className="grid-2">
        <label>الدور<select value={editing.role} onChange={(event) => setEditing({ ...editing, role: event.target.value as Role, grants: [], revokes: [], permissions: [...ROLE_PERMISSIONS[event.target.value as Role]] })}>
          {roles && Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
        <label>أقصى خصم مسموح %<input type="number" min={0} max={100} value={editing.maxDiscountBps / 100} onChange={(event) => setEditing({ ...editing, maxDiscountBps: Math.round(Number(event.target.value) * 100) })} /></label>
      </div>
      <label>الفرع<select value={editing.branchId ?? ""} onChange={(event) => setEditing({ ...editing, branchId: event.target.value || null })}>
        <option value="">كل الفروع</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> الحساب نشط</label>
      <div className="permissions">{PERMISSIONS.map((permission) => <label key={permission} className="check">
        <input type="checkbox" checked={editing.permissions.includes(permission)} onChange={(event) => toggle(editing, permission, event.target.checked)} /> {PERMISSION_LABELS[permission]}
      </label>)}</div>
      <div className="row"><button className="primary" onClick={saveMember} disabled={action.busy}>حفظ</button><button className="ghost" onClick={() => setEditing(null)}>إلغاء</button></div>
    </div></div>}

    <div className="card">
      <h3>سجل التدقيق</h3>
      <ul className="list">{(audit.data?.data ?? []).map((entry) => <li key={entry.id}>
        <div><b>{entry.action}</b><small>{entry.staffId ?? "—"} · {entry.targetType ?? ""}</small></div><small>{new Date(entry.createdAt).toLocaleString("ar-SA")}</small>
      </li>)}</ul>
    </div>
  </div>;
}
