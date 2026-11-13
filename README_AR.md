# DAFQLY — تطوير AI والتحصيل وتجربة SaaS

هذه الحزمة تضيف إلى الأساس السابق: Streaming حقيقي لنص إجابة Copilot عبر SSE، وTool Calling متعدد الأدوار، وطلبات إجراءات AI بموافقة مالك المنشأة، وتعهدات سداد مترابطة بالدفتر المالي، وتوزيع مهام التحصيل على الفريق، وبوابة عميل لطلب موعد السداد، وسقف إنفاق AI شهري على مستوى المنصة مع حجز ذري ومراقبة تشغيلية. كما تمت إعادة بناء رسومات التحصيل لتكون SVG/CSS خفيفة ومبنية على بيانات الدفتر، وإزالة الرسومات التوضيحية الزخرفية من الشاشات التشغيلية.

## التشغيل المحلي

1. استخدم Node.js 22 أو أحدث و`pnpm` بالإصدار المحدد في `package.json`.
2. انسخ `.env.example` إلى `.env` واضبط `DATABASE_URL` و`APP_DATABASE_URL` و`REDIS_URL` وبيانات S3/MinIO المحلية. اترك `DRY_RUN_MESSAGING=true` أثناء التطوير.
3. اختر مزود AI: `AI_PROVIDER=gemini` مع `GEMINI_API_KEY`، أو `AI_PROVIDER=anthropic` مع `ANTHROPIC_API_KEY`.
4. نفّذ `pnpm install` ثم `pnpm db:migrate` و`pnpm db:seed`.
5. شغّل `pnpm dev` و`pnpm worker` في طرفيتين منفصلتين.

## قاعدة البيانات

`0010_persisted_ai_conversations.sql` تضيف المحادثات والرسائل. `0011_collections_team_ai_actions_budget.sql` تضيف `promises_to_pay` و`collection_tasks` و`ai_action_approvals` وجداول محاسبة استخدام AI على مستوى المنصة. شغّل `pnpm db:migrate` قبل تشغيل النسخة الجديدة. لا تستخدم الـCopilot أو مساحة التحصيل قبل اكتمال الـMigrations.

## ميزات هذه النسخة

- **AI Streaming:** مسار `/api/ai/copilot/stream` يرسل `token` events فعلية من Gemini أو Anthropic عبر SSE، ثم حدث `done` يحتوي الإجابة المحفوظة وسجل الأدوات. استدعاء الأدوات والتحقق من البيانات يسبق بث الصياغة النهائية؛ لذلك لا تظهر Tokens قبل انتهاء جلب الأدلة.
- **AI Action Approval:** يستطيع النموذج اقتراح مهمة تحصيل أو جدولة تذكير WhatsApp فقط. الطلب يظل Pending؛ موافقة Owner تعيد التحقق من حالة العميل والفاتورة وOpt-out والاعتراضات وسياسة الرسائل، ثم تنشئ المهمة أو تضع التذكير في Queue. هذا لا يرسل الرسالة لحظياً.
- **Promise-to-Pay:** طلبات بوابة العميل Pending حتى يراجعها Owner. التعهدات المسجلة من المنشأة معتمدة بعد تسجيلها. يصبح التعهد `kept` تلقائياً فقط بعد أن تغطي تخصيصات الدفعات المؤكدة المسجلة بعد اعتماد التعهد المبلغ المتفق عليه؛ لا يلزم إغلاق الفاتورة كاملة إذا كان التعهد جزئياً. إيصال التحويل أو Payment Claim لا يفي بالتعهد.
- **Team Collections:** Owner يستطيع إسناد المهمة إلى عضو في نفس Tenant وإعادة إسنادها. الموظف يرى مهامه المسندة إليه ويحدّث حالتها، ولا يستطيع تغيير مسؤول المهمة.
- **Customer Portal:** يستطيع العميل مشاهدة كشف الحساب والفواتير والمدفوعات المؤكدة والاعتراض وطلب موعد سداد. رابط البوابة Bearer Token؛ يجب حمايته وعدم نشره علناً.
- **Global AI USD Cap:** `AI_GLOBAL_MONTHLY_USD_CAP` سقف شهري بالدولار، و`AI_GLOBAL_REQUEST_RESERVE_USD` مبلغ محجوز قبل كل استدعاء Provider. كل الاستدعاءات الواقعة داخل Tenant Request Context تسجل في `ai_global_usage`، والحجز والتسوية على اتصال Owner DB داخل Transaction مع Lock.
- **Platform telemetry:** أضف User IDs المصرح لهم مفصولة بفواصل إلى `PLATFORM_ADMIN_USER_IDS` لعرض `/[locale]/platform/ai-budget`. الصفحة لا تسمح بتعديل السقف؛ غيّره من إعدادات بيئة التشغيل ثم أعد نشر التطبيق.
- **Charts:** SVG/CSS على بيانات فعلية: Cash-flow projection، Aging، Reminder funnel، concentration/exposure، وأكبر أرصدة العملاء. لا تستخدم Canvas أو Chart.js للرسومات الجديدة.

## حدود السقف المالي للـAI

السقف آلية `atomic admission control`: يحجز النظام مبلغاً قبل استدعاء المزود، ويرفض استدعاءات جديدة عندما يصبح الإنفاق المسجل + الحجوزات أكبر من السقف. بعد وصول Usage من المزود تتم تسوية التكلفة التقديرية. لا يمكن ضمان أن فاتورة المزود لن تتجاوز السقف بدقة مطلقة، لأن التكلفة النهائية لا تصل إلا بعد انتهاء الاستدعاء، وقد تكون أعلى من الحجز. لذلك استخدم `AI_GLOBAL_REQUEST_RESERVE_USD` محافظاً، وضع حدود Tokens/Output لدى المزود، وراجع فواتير Google/Anthropic. التسعير المحاسبي تقديري ويجب تحديث جدول الأسعار عند تغير أسعار المزود أو أسماء النماذج.

الجدول `ai_global_usage` يسجل Model وTenant ID والـTokens والتكلفة المحسوبة لكل Provider Call. صفحة المراقبة تستخدم اتصال Owner ولا تعرض بيانات مالية أو تفاصيل Tenant لمستخدم عادي. لا تضبط `PLATFORM_ADMIN_USER_IDS` على حسابات العملاء.

## ما يحتاج أسراراً أو تحققاً حياً

- يلزم تشغيل Migration 0011 على PostgreSQL للتأكد من توافق SQL/RLS والصلاحيات.
- اختبر SSE خلف Caddy/Nginx/CDN؛ يجب تعطيل Buffering لمسار Copilot، وتأكد من وصول Deltas دون تجميع.
- اختبر Gemini وAnthropic بمفاتيح صحيحة، وتحقق من Token Usage الذي يعيده كل Provider.
- اختبر WhatsApp Cloud API والـWebhook على Staging. الإجراءات المقترحة تضع Reminder في Queue فقط.
- لا يوجد SMS Adapter حقيقي. لا يتم اقتراح إرسال SMS ضمن AI Actions في هذه النسخة.
- إعداد S3 يتطلب Bucket خاصاً وHTTPS ومفاتيح إنتاجية وسياسة Lifecycle ونسخاً احتياطياً.
- بوابة Paymob تحتاج Credentials حقيقية واختبار HMAC وإشعار الدفع قبل تشغيل Live.
- لا تُعتبر النسخة Production-certified قبل تشغيل `pnpm lint` و`pnpm typecheck` و`pnpm test` و`pnpm build` و`pnpm test:e2e` على قاعدة بيانات Staging.

## قرارات أمان مهمة

- لا يحصل النموذج على SQL أو Database Credentials. جميع الأدوات Server-side، Tenant-scoped، ومتحقق منها بـZod.
- لا يستطيع AI تأكيد دفعة أو تعديل فاتورة أو تغيير رصيد أو إرسال رسالة فوراً.
- Owner فقط يوافق على إجراءات AI وطلبات مواعيد السداد القادمة من البوابة.
- الموظف يستطيع تحديث المهام المسندة إليه فقط، ولا يعيد إسنادها.
- بيانات العميل داخل ملاحظاته ورسائله تعامل كبيانات غير موثوقة، وليست تعليمات للنموذج.
- رابط كشف الحساب سر وصول؛ ألغِه عند تسربه أو انتهاء الحاجة إليه.

## مراجع التشغيل

- `docs/PROGRESS.md`
- `docs/DECISIONS.md`
- `docs/RUNBOOK.md`
- `docs/SECURITY.md`
- `docs/BRAND_GUIDELINES.md`
- `docs/BUILD_PLAN.md`
