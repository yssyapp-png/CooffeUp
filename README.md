# CooffeUp

منصة نقاط بيع للمقاهي تعمل على الويب والجوال، ببنية موحدة ودعم عربي/إنجليزي.

## التشغيل

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev
```

- الويب: `http://localhost:5173`
- API: `http://localhost:4000`
- فحص الصحة: `http://localhost:4000/health`

## الجودة

```bash
npm run check
```

الحسابات المالية تستخدم أعدادًا صحيحة بالهللات لمنع أخطاء الكسور العشرية. مفتاح `Idempotency-Key` مطلوب لإنشاء الطلب ويمنع تكرار الخصم عند ضعف الشبكة.

