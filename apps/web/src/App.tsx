import { useState, type ComponentType } from "react";
import type { Feature, Permission } from "@cooffeup/shared";
import {
  BarChart3, Bike, BookOpen, CalendarClock, ChefHat, Coffee, LogOut, Plug, Receipt, ShieldCheck, ShoppingBag, Users, Wallet, Wifi, WifiOff
} from "lucide-react";
import { Login } from "./pages/Login";
import { Pos } from "./pages/Pos";
import { ChannelOrders } from "./pages/ChannelOrders";
import { Kitchen } from "./pages/Kitchen";
import { Appointments } from "./pages/Appointments";
import { Customers } from "./pages/Customers";
import { Purchases } from "./pages/Purchases";
import { Accounting } from "./pages/Accounting";
import { Reports } from "./pages/Reports";
import { Integrations } from "./pages/Integrations";
import { Staff } from "./pages/Staff";
import { Shift } from "./pages/Shift";
import { LanguageProvider, useI18n, type StringKey } from "./i18n";
import { useOnline } from "./offline";
import { SessionProvider, useSession } from "./session";

interface PageDef {
  id: string;
  label: StringKey;
  /** Translated screens follow the chosen language; back-office screens stay Arabic right-to-left. */
  bilingual?: boolean;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType;
  anyOf: Permission[];
  features?: Feature[];
}

const PAGES: PageDef[] = [
  { id: "pos", label: "nav_pos", bilingual: true, icon: ShoppingBag, component: Pos, anyOf: ["pos.sell"] },
  { id: "channels", label: "nav_channels", icon: Bike, component: ChannelOrders, anyOf: ["delivery.manage"] },
  { id: "kitchen", label: "nav_kitchen", icon: ChefHat, component: Kitchen, anyOf: ["kitchen.view", "tables.manage"], features: ["kitchen", "tables"] },
  { id: "appointments", label: "nav_appointments", icon: CalendarClock, component: Appointments, anyOf: ["appointments.manage"], features: ["appointments"] },
  { id: "customers", label: "nav_customers", icon: Users, component: Customers, anyOf: ["customers.view"] },
  { id: "shift", label: "nav_shift", bilingual: true, icon: Wallet, component: Shift, anyOf: ["shifts.manage"] },
  { id: "purchases", label: "nav_purchases", icon: Receipt, component: Purchases, anyOf: ["purchases.manage", "expenses.manage"] },
  { id: "accounting", label: "nav_accounting", icon: BookOpen, component: Accounting, anyOf: ["accounting.view"] },
  { id: "reports", label: "nav_reports", icon: BarChart3, component: Reports, anyOf: ["reports.view"] },
  { id: "integrations", label: "nav_integrations", icon: Plug, component: Integrations, anyOf: ["integrations.manage"] },
  { id: "staff", label: "nav_staff", icon: ShieldCheck, component: Staff, anyOf: ["staff.manage"] }
];

function Shell() {
  const { staff, settings, can, hasFeature, logout } = useSession();
  const online = useOnline();
  const { t, toggle, lang } = useI18n();
  const pages = PAGES.filter((page) => page.anyOf.some(can) && (!page.features || page.features.some(hasFeature)));
  const [active, setActive] = useState(pages[0]?.id);
  const current = pages.find((page) => page.id === active);
  const Page = current?.component;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span><Coffee size={22} /></span><div><b>CooffeUp</b><small>{settings.branchName || settings.sector.nameAr}</small></div></div>
      <nav aria-label={lang === "ar" ? "الأقسام" : "Sections"}>{pages.map((page) => <button key={page.id} className={page.id === active ? "active" : ""} onClick={() => setActive(page.id)}>
        <page.icon size={18} /><span>{t(page.label)}</span>
      </button>)}</nav>
      <div className="sidebar-foot">
        <div className={`status ${online ? "" : "offline"}`}>{online ? <><Wifi size={15} /> {t("online")}</> : <><WifiOff size={15} /> {t("offlineSelling")}</>}</div>
        <div className="me"><b>{staff.name}</b><small>{staff.roleLabel}</small></div>
        <div className="row">
          <button className="ghost" onClick={toggle} lang={lang === "ar" ? "en" : "ar"}>{t("language")}</button>
          <button className="ghost" onClick={logout}><LogOut size={16} /> {t("logout")}</button>
        </div>
      </div>
    </aside>
    <main className="content" {...(current && !current.bilingual ? { dir: "rtl", lang: "ar" } : {})}>{Page ? <Page /> : <p className="muted center">{t("noSections")}</p>}</main>
  </div>;
}

export function App() {
  return <LanguageProvider><SessionProvider login={(onLogin) => <Login onLogin={onLogin} />}><Shell /></SessionProvider></LanguageProvider>;
}
