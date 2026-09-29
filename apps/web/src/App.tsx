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
import { useOnline } from "./offline";
import { SessionProvider, useSession } from "./session";

interface PageDef {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType;
  anyOf: Permission[];
  features?: Feature[];
}

const PAGES: PageDef[] = [
  { id: "pos", label: "نقطة البيع", icon: ShoppingBag, component: Pos, anyOf: ["pos.sell"] },
  { id: "channels", label: "الطلبات الموحدة", icon: Bike, component: ChannelOrders, anyOf: ["delivery.manage"] },
  { id: "kitchen", label: "المطبخ والطاولات", icon: ChefHat, component: Kitchen, anyOf: ["kitchen.view", "tables.manage"], features: ["kitchen", "tables"] },
  { id: "appointments", label: "المواعيد", icon: CalendarClock, component: Appointments, anyOf: ["appointments.manage"], features: ["appointments"] },
  { id: "customers", label: "العملاء", icon: Users, component: Customers, anyOf: ["customers.view"] },
  { id: "shift", label: "الوردية والصندوق", icon: Wallet, component: Shift, anyOf: ["shifts.manage"] },
  { id: "purchases", label: "المشتريات والمصروفات", icon: Receipt, component: Purchases, anyOf: ["purchases.manage", "expenses.manage"] },
  { id: "accounting", label: "المحاسبة", icon: BookOpen, component: Accounting, anyOf: ["accounting.view"] },
  { id: "reports", label: "التقارير", icon: BarChart3, component: Reports, anyOf: ["reports.view"] },
  { id: "integrations", label: "الربط والمنصات", icon: Plug, component: Integrations, anyOf: ["integrations.manage"] },
  { id: "staff", label: "الموظفون والصلاحيات", icon: ShieldCheck, component: Staff, anyOf: ["staff.manage"] }
];

function Shell() {
  const { staff, settings, can, hasFeature, logout } = useSession();
  const online = useOnline();
  const pages = PAGES.filter((page) => page.anyOf.some(can) && (!page.features || page.features.some(hasFeature)));
  const [active, setActive] = useState(pages[0]?.id);
  const Page = pages.find((page) => page.id === active)?.component;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span><Coffee size={22} /></span><div><b>CooffeUp</b><small>{settings.branchName || settings.sector.nameAr}</small></div></div>
      <nav aria-label="الأقسام">{pages.map((page) => <button key={page.id} className={page.id === active ? "active" : ""} onClick={() => setActive(page.id)}>
        <page.icon size={18} /><span>{page.label}</span>
      </button>)}</nav>
      <div className="sidebar-foot">
        <div className={`status ${online ? "" : "offline"}`}>{online ? <><Wifi size={15} /> متصل</> : <><WifiOff size={15} /> بلا إنترنت — البيع مستمر</>}</div>
        <div className="me"><b>{staff.name}</b><small>{staff.roleLabel}</small></div>
        <button className="ghost" onClick={logout}><LogOut size={16} /> خروج</button>
      </div>
    </aside>
    <main className="content">{Page ? <Page /> : <p className="muted center">لا توجد أقسام متاحة لصلاحياتك</p>}</main>
  </div>;
}

export function App() {
  return <SessionProvider login={(onLogin) => <Login onLogin={onLogin} />}><Shell /></SessionProvider>;
}
