import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { BusinessType, Feature, Permission, SectorProfile } from "@cooffeup/shared";
import { api, setSession } from "./api";

export interface SessionStaff {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  permissions: Permission[];
  maxDiscountBps: number;
}

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
  can(permission: Permission): boolean;
  hasFeature(feature: Feature): boolean;
  logout(): void;
  reloadSettings(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const STORAGE_KEY = "cu.session";

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
    reloadSettings().catch(() => {
      // Offline start: fall back to a café profile until the server is reachable.
      setSettings((current) => current ?? { businessType: "cafe", sellerName: "CooffeUp", sellerVat: "", branchName: "", sector: { nameAr: "مقهى", group: "food", features: ["tables", "kitchen", "delivery"], orderTypes: ["dine_in", "takeaway", "delivery"] } });
    });
  }, [state, logout, reloadSettings]);

  if (!state) {
    return <>{login((token, staff) => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, staff }));
      setSession(token, logout);
      setState({ token, staff });
    })}</>;
  }
  if (!settings) return <div className="boot">جارٍ التحميل…</div>;

  const value: SessionValue = {
    staff: state.staff, settings, logout, reloadSettings,
    can: (permission) => state.staff.permissions.includes(permission),
    hasFeature: (feature) => settings.sector.features.includes(feature)
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
