# الدفع الإلكتروني عبر ميسر والربط مع سكاي لاين

## سير العملية

1. الكاشير يضغط «دفع إلكتروني عبر ميسر».
2. الواجهة تطلب `POST /api/v1/payments/moyasar/checkout`، والخادم يحسب المبلغ بنفسه (لا يثق بمبلغ المتصفح)، وينشئ طلبًا بحالة `pending_payment` ويحجز المخزون.
3. يظهر نموذج ميسر (بطاقات مدى/فيزا/ماستركارد، Apple Pay، STC Pay) ويحوّل العميل بعد الدفع إلى `/payment/callback?id=...`.
4. صفحة الرجوع تستدعي `POST /api/v1/payments/moyasar/verify`، فيجلب الخادم العملية من ميسر بالمفتاح السري، ويتحقق من الحالة والمبلغ والعملة ورقم الطلب، ثم يحوّل الطلب إلى `paid`.
5. الويبهوك `POST /api/v1/webhooks/moyasar` يؤكد الدفع حتى لو أغلق العميل الصفحة قبل الرجوع.
6. كل طلب مدفوع (نقدي أو إلكتروني) يُرسل إلى سكاي لاين تلقائيًا مع إعادة المحاولة.

إذا فشل الدفع يتحول الطلب إلى `payment_failed` ويُعاد المخزون المحجوز.

## الإعداد في لوحة ميسر

1. من **Settings → API Keys** انسخ المفتاحين إلى `apps/api/.env`:
   - `MOYASAR_SECRET_KEY` (يبدأ بـ `sk_`) — على الخادم فقط.
   - `MOYASAR_PUBLISHABLE_KEY` (يبدأ بـ `pk_`).
2. من **Settings → Webhooks** أضف:
   - URL: `https://<نطاق-الـAPI>/api/v1/webhooks/moyasar`
   - Secret Token: قيمة عشوائية طويلة، وضعها نفسها في `MOYASAR_WEBHOOK_SECRET`.
   - الأحداث: `payment_paid` و `payment_failed`.
3. اضبط `PUBLIC_WEB_URL` على رابط الموقع العام (مثل `https://pos.example.com`).
4. لـ Apple Pay: سجّل النطاق في ميسر وارفع ملف التحقق إلى `/.well-known/apple-developer-merchantid-domain-association`.
5. على الاستضافة: اجعل المسار `/payment/callback` يعيد `index.html` (SPA rewrite).

ابدأ بمفاتيح الاختبار `sk_test_`/`pk_test_` وبطاقات الاختبار من وثائق ميسر قبل التحويل للمفاتيح الحية.

## سكاي لاين

```
SKYLINE_API_URL=https://<رابط-API-سكاي-لاين>
SKYLINE_API_KEY=<المفتاح>
SKYLINE_ORDERS_PATH=/orders
SKYLINE_BRANCH_ID=<رقم الفرع>
```

- يُرسل الطلب بـ `POST` مع `Authorization: Bearer` و `Idempotency-Key` = رقم الطلب لمنع التكرار.
- شكل البيانات في `toSkylinePayload` داخل `apps/api/src/skyline.ts`؛ عدّله ليطابق وثائق API الخاصة بحسابك في سكاي لاين.
- حالة المزامنة: `GET /api/v1/integrations/skyline`، وإعادة إرسال طلب فشل: `POST /api/v1/integrations/skyline/:orderId/retry`.
- بدون ضبط المتغيرات يبقى الربط معطّلًا ولا يؤثر على البيع.
