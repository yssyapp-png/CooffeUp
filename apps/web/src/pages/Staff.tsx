import { useState } from "react";
import { PERMISSION_LABELS, PERMISSIONS, ROLE_PERMISSIONS, SECTOR_PROFILES, type BusinessType, type Permission, type Role } from "@cooffeup/shared";
import { ShieldCheck, UserPlus } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { useSession } from "../session";

interface StaffView { id: string; name: string; role: Role; roleLabel: string; active: boolean; grants: Permission[]; revokes: Permission[]; maxDiscountBps: number; permissions: Permission[]; branchId: string | null }
interface AuditView { id: string; staffId?: string; action: string; targetType?: string; createdAt: string }

export function Staff() {
  const { settings, reloadSettings, branches } = useSession();
  const { L, tx, dateTime } = useI18n();
  const branchName = (id: string | null) => (id ? tx(branches.find((branch) => branch.id === id)?.name ?? id) : L("كل الفروع", "All branches"));
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
    await action.run(() => api(`/api/v1/staff/${editing.id}`, { method: "PATCH", body: { role: editing.role, active: editing.active, grants: editing.grants, revokes: editing.revokes, maxDiscountBps: editing.maxDiscountBps, branchId: editing.branchId } }), L("تم حفظ الصلاحيات، وسيُطلب من الموظف تسجيل الدخول من جديد", "Permissions saved; the staff member will be asked to sign in again"));
    setEditing(null);
    reload();
  }

  return <div className="page">
    <PageHeader eyebrow={L("صلاحيات دقيقة للبائعين وسجل تدقيق", "Fine-grained staff permissions and an audit log")} title={L("الموظفون والصلاحيات", "Staff & permissions")} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>{L("الموظف", "Staff member")}</th><th>{L("الدور", "Role")}</th><th>{L("الفرع", "Branch")}</th><th>{L("حد الخصم", "Discount limit")}</th><th>{L("الحالة", "Status")}</th><th /></tr></thead>
          <tbody>{(staff.data?.data ?? []).map((member) => <tr key={member.id}>
            <td>{member.name}</td><td>{tx(member.roleLabel)}</td><td>{branchName(member.branchId)}</td><td className="num">{member.maxDiscountBps / 100}%</td><td>{member.active ? L("نشط", "Active") : L("موقوف", "Suspended")}</td>
            <td><button className="ghost small" onClick={() => setEditing(member)}><ShieldCheck size={14} /> {L("الصلاحيات", "Permissions")}</button></td>
          </tr>)}</tbody>
        </table></div>
      </div>
      <div className="stack">
        <form className="card form" onSubmit={async (event) => {
          event.preventDefault();
          const created = await action.run(() => api("/api/v1/staff", { method: "POST", body: { ...form, branchId: form.branchId || undefined } }), L("تمت إضافة الموظف", "Staff member added"));
          if (created) { setForm({ name: "", role: "cashier", pin: "", branchId: "" }); reload(); }
        }}>
          <h3><UserPlus size={16} /> {L("موظف جديد", "New staff member")}</h3>
          <label>{L("الاسم", "Name")}<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{L("الدور", "Role")}<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>{roles && Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{tx(label)}</option>)}</select></label>
          <label>{L("الفرع", "Branch")}<select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>
            <option value="">{L("كل الفروع (يختار عند العمل)", "All branches (chosen at the till)")}</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{tx(branch.name)}</option>)}</select></label>
          <label>{L("الرمز السري (4–8 أرقام)", "PIN (4–8 digits)")}<input type="password" inputMode="numeric" pattern="\d{4,8}" required value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} /></label>
          <button className="primary" disabled={action.busy}>{L("إضافة", "Add")}</button>
        </form>
        <div className="card form">
          <h3>{L("نوع النشاط", "Business type")}</h3>
          <select value={settings.businessType} onChange={async (event) => { await action.run(() => api("/api/v1/settings", { method: "PATCH", body: { businessType: event.target.value as BusinessType } }), L("تم تغيير نوع النشاط", "Business type changed")); await reloadSettings(); }}>
            {Object.entries(SECTOR_PROFILES).map(([type, profile]) => <option key={type} value={type}>{tx(profile.nameAr)}</option>)}
          </select>
          <small className="muted">{L("يحدد الواجهات المتاحة: الطاولات والمطبخ للمطاعم والمقاهي، المواعيد للصالونات والعيادات والمغاسل، والباركود للتجزئة.", "Decides which screens appear: tables and kitchen for restaurants and cafés, appointments for salons, clinics and laundries, barcode for retail.")}</small>
        </div>
      </div>
    </div>

    {editing && <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="perm-title"><div className="dialog wide">
      <h2 id="perm-title">{L("صلاحيات", "Permissions of")} {editing.name}</h2>
      <div className="grid-2">
        <label>{L("الدور", "Role")}<select value={editing.role} onChange={(event) => setEditing({ ...editing, role: event.target.value as Role, grants: [], revokes: [], permissions: [...ROLE_PERMISSIONS[event.target.value as Role]] })}>
          {roles && Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{tx(label)}</option>)}</select></label>
        <label>{L("أقصى خصم مسموح %", "Maximum discount %")}<input type="number" min={0} max={100} value={editing.maxDiscountBps / 100} onChange={(event) => setEditing({ ...editing, maxDiscountBps: Math.round(Number(event.target.value) * 100) })} /></label>
      </div>
      <label>{L("الفرع", "Branch")}<select value={editing.branchId ?? ""} onChange={(event) => setEditing({ ...editing, branchId: event.target.value || null })}>
        <option value="">{L("كل الفروع", "All branches")}</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{tx(branch.name)}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> {L("الحساب نشط", "Account active")}</label>
      <div className="permissions">{PERMISSIONS.map((permission) => <label key={permission} className="check">
        <input type="checkbox" checked={editing.permissions.includes(permission)} onChange={(event) => toggle(editing, permission, event.target.checked)} /> {tx(PERMISSION_LABELS[permission])}
      </label>)}</div>
      <div className="row"><button className="primary" onClick={saveMember} disabled={action.busy}>{L("حفظ", "Save")}</button><button className="ghost" onClick={() => setEditing(null)}>{L("إلغاء", "Cancel")}</button></div>
    </div></div>}

    <div className="card">
      <h3>{L("سجل التدقيق", "Audit log")}</h3>
      <ul className="list">{(audit.data?.data ?? []).map((entry) => <li key={entry.id}>
        <div><b>{entry.action}</b><small>{entry.staffId ?? "—"} · {entry.targetType ?? ""}</small></div><small>{dateTime(entry.createdAt)}</small>
      </li>)}</ul>
    </div>
  </div>;
}
