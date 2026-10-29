import { useEffect, useState } from "react";
import { CheckCircle2, Coffee, XCircle } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
type State = {kind:"loading"} | {kind:"paid";receipt:string} | {kind:"failed";message:string};

/** Moyasar redirects here with ?id=&status=&message=. The status in the URL is untrusted; the API verifies it with Moyasar. */
export function PaymentCallback() {
  const [state,setState] = useState<State>({kind:"loading"});
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) { setState({kind:"failed",message:"لا يوجد رقم عملية"}); return; }
    fetch(`${API}/api/v1/payments/moyasar/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({paymentId:id})})
      .then(async r => {
        const body = await r.json();
        if (r.ok && body.data?.status === "paid") setState({kind:"paid",receipt:body.data.receiptNumber});
        else setState({kind:"failed",message:body.message ?? params.get("message") ?? body.error ?? "لم تكتمل عملية الدفع"});
      })
      .catch(() => setState({kind:"failed",message:"تعذر التحقق من الدفع، حاول التحديث"}));
  }, []);
  return <div className="callback">
    <div className="callback-card">
      {state.kind==="loading" && <><Coffee/><h1>جارٍ التحقق من الدفع...</h1></>}
      {state.kind==="paid" && <><CheckCircle2 className="ok"/><h1>تم الدفع بنجاح</h1><p>رقم الإيصال {state.receipt}</p></>}
      {state.kind==="failed" && <><XCircle className="bad"/><h1>فشل الدفع</h1><p>{state.message}</p></>}
      {state.kind!=="loading" && <a href="/">العودة إلى نقطة البيع</a>}
    </div>
  </div>;
}
