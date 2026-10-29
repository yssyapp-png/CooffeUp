import { useEffect, useRef, useState } from "react";
import { formatSar } from "@cooffeup/shared";
import { X } from "lucide-react";
import { mountMoyasarForm, type MoyasarCheckout } from "./moyasar";

export function MoyasarDialog({checkout,onClose}:{checkout:MoyasarCheckout;onClose:()=>void}) {
  const form = useRef<HTMLDivElement>(null);
  const [error,setError] = useState("");
  useEffect(() => { if (form.current) mountMoyasarForm(form.current, checkout).catch(e => setError(e.message)); }, [checkout]);
  return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="الدفع الإلكتروني">
    <div className="dialog">
      <div className="dialog-head"><div><h2>الدفع عبر ميسر</h2><small>الطلب {checkout.receiptNumber} · {formatSar(checkout.amount)}</small></div><button aria-label="إغلاق" onClick={onClose}><X/></button></div>
      {error && <div className="message" role="alert">{error}</div>}
      <div ref={form} className="mysr-form" dir="ltr"/>
    </div>
  </div>;
}
