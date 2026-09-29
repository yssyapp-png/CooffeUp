import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { BusinessType, Feature, Permission, SectorProfile } from "@cooffeup/shared";
import { api, setBranch, setSession } from "./api";

export interface SessionStaff {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  permissions: Permission[];
  maxDiscountBps: number;
  /** Set when the member may only work at one branch. */
  branchId: string | null;
}

export interface BranchOption { id: string; name: string; kind: "permanent" | "temporary"; active: boolean; isOpen: boolean }

export interface Settings {
  businessType: BusinessType;
  sellerName: string;
  sellerVat: string;
  branchName: string;
  sector: SectorProfile;
}

interface SessionValue {
  staff: SessionStaff;
  settings: Settings;
  branches: BranchOption[];
  branchId: string;
  switchBranch(branchId: string): void;
  reloadBranches(): Promise<void>;
  can(permission: Permission): boolean;
  hasFeature(feature: Feature): boolean;
  logout(): void;
  reloadSettings(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const STORAGE_KEY = "cu.session";
const BRANCH_KEY = "cu.branch";

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside provider");
  return value;
}

/** The token lives in sessionStorage so closing the browser tab ends the session on shared tills. */
export function SessionProvider({ login, children }: { login: (onLogin: (token: string, staff: SessionStaff) => void) => ReactNode; children: ReactNode }) {
  const [state, setState] = useState<{ token: string; staff: SessionStaff } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      return null;
    }
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState<string>(() => {
    try {
      return localStorage.getItem(BRANCH_KEY) ?? "main";
    } catch {
      return "main";
    }
  });
  // Staff tied to a branch always work there, whatever this device used last.
  const effectiveBranch = state?.staff.branchId ?? branchId;
  setBranch(state ? effectiveBranch : null);

  const switchBranch = useCallback((id: string) => {
    setBranchId(id);
    try {
      localStorage.setItem(BRANCH_KEY, id);
    } catch {
      // The choice lasts for this page only.
    }
  }, []);

  const reloadBranches = useCallback(async () => {
    const { data } = await api<{ data: BranchOption[] }>("/api/v1/branches");
    setBranches(data);
    // A remembered branch that was closed or removed falls back to the main branch.
    setBranchId((current) => (data.some((branch) => branch.id === current && branch.active) ? current : "main"));
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setState(null);
    setSettings(null);
  }, []);

  const reloadSettings = useCallback(async () => {
    const { data } = await api<{ data: Settings }>("/api/v1/settings");
    setSettings(data);
  }, []);

  useEffect(() => {
    if (!state) return;
    setSession(state.token, logout);
    reloadBranches().catch(() => undefined);
    reloadSettings().catch(() => {
      // Offline start: fall back to a café profile until the server is reachable.
      setSettings((current) => current ?? { businessType: "cafe", sellerName: "CooffeUp", sellerVat: "", branchName: "", sector: { nameAr: "مقهى", group: "food", features: ["tables", "kitchen", "delivery"], orderTypes: ["dine_in", "takeaway", "delivery"] } });
    });
  }, [state, logout, reloadSettings, reloadBranches]);

  if (!state) {
    return <>{login((token, staff) => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, staff }));
      setSession(token, logout);
      setState({ token, staff });
    })}</>;
  }
  if (!settings) return <div className="boot">جارٍ التحميل…</div>;

  const value: SessionValue = {
    staff: state.staff, settings, logout, reloadSettings, branches, branchId: effectiveBranch, switchBranch, reloadBranches,
    can: (permission) => state.staff.permissions.includes(permission),
    hasFeature: (feature) => settings.sector.features.includes(feature)
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
