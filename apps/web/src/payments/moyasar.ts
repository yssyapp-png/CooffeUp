const VERSION = import.meta.env.VITE_MOYASAR_FORM_VERSION ?? "1.14.0";
const CDN = `https://cdn.moyasar.com/mpf/${VERSION}`;

export interface MoyasarCheckout {
  orderId: string;
  receiptNumber: string;
  amount: number;
  currency: "SAR";
  description: string;
  publishableKey: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

declare global {
  interface Window { Moyasar?: { init(options: Record<string, unknown>): void } }
}

let loading: Promise<void> | undefined;
export function loadMoyasar() {
  loading ??= new Promise<void>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = `${CDN}/moyasar.css`;
    document.head.append(css);
    const script = document.createElement("script");
    script.src = `${CDN}/moyasar.js`;
    script.onload = () => resolve();
    script.onerror = () => { loading = undefined; reject(new Error("تعذر تحميل نموذج ميسر")); };
    document.head.append(script);
  });
  return loading;
}

export async function mountMoyasarForm(element: HTMLElement, checkout: MoyasarCheckout) {
  await loadMoyasar();
  element.innerHTML = "";
  window.Moyasar!.init({
    element,
    amount: checkout.amount,
    currency: checkout.currency,
    description: checkout.description,
    publishable_api_key: checkout.publishableKey,
    callback_url: checkout.callbackUrl,
    metadata: checkout.metadata,
    language: "ar",
    methods: ["creditcard", "applepay", "stcpay"],
    supported_networks: ["mada", "visa", "mastercard"],
    apple_pay: {country:"SA", label:"CooffeUp", validate_merchant_url:"https://api.moyasar.com/v1/applepay/initiate"}
  });
}
