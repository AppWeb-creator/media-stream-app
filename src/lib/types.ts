export type Role = 'admin' | 'staff';

export interface User {
  username: string;
  displayName: string;
  role: Role;
  /** رابط صورة الملف الشخصي للمستخدم المسجل — يُعرض في تراكيب الترحيب. */
  avatarUrl?: string;
}

export type RateType = 'single' | 'multi' | 'game';
export type SessionType = 'open' | 'limited';
export type SessionStatus = 'active' | 'settled' | 'cancelled';
export type ItemCategory = 'drinks' | 'food';

/** الأحداث الصوتية القابلة للتخصيص من لوحة الإدارة — كل حدث يحمل رابط ملف صوتي (HTML5). */
export interface AlertSounds {
  sessionStarted: string;   // بدء الجلسة
  sessionExpired: string;   // انتهاء الوقت الأصلي للجلسة
  almostUp: string;         // اقتراب انتهاء الوقت الأصلي للجلسة
  sessionExtended: string;  // تمديد وقت الجلسة
  sessionCancelled: string; // إلغاء الجلسة بدون تحصيل
  paymentCollected: string; // تم تحصيل المبلغ
  sessionPaused: string;    // توقف مؤقت للجلسة
  sessionResumed: string;   // استئناف الجلسة
}

/** مباراة قادمة تُعرض في بنر المباريات وتُفعّل التنبيهات الصوتية — يدوية (يضيفها المدير). */
export interface MatchEntry {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  league: string;
  leagueBadge?: string;
  /** موعد المباراة بالمللي ثانية. */
  startTime: number;
  /** بطولة محلية (Egyptian/الدوري المصري) → OnTime Sports، عالمية → beIN Sports. */
  domestic: boolean;
  /** صورة بنر مخصصة تُعرض فوق المباراة (اختياري — لا تغطي الشعارات). */
  bannerImage?: string;
  source: 'auto' | 'manual';
  /** رابط بث مباشر لهذه المباراة (HLS .m3u8 / .ts / MP4) — يُدار من لوحة الإدارة (مدير فقط) ويُشغَّل بمشغّل الفيديو. */
  streamUrl?: string;
}

/** إعدادات تنبيهات المباريات — تُدار من تبويب إدارة بنر المباريات (نافذة التنبيه المسبق + الصوت). */
export interface MatchSettings {
  /** تشغيل التنبيهات الصوتية للمباريات القادمة (غداً / اليوم). */
  audioEnabled: boolean;
  /** دقائق بين تكرار التنبيه الصوتي (30 / 60 / 120). */
  alertIntervalMin: number;
  /** مباريات مخصصة يدوياً — تُحفظ فوراً في Firestore ولا تختفي. */
  manualMatches?: MatchEntry[];
  /** روابط البث المباشر للمباريات (مفتاح = معرّف المباراة) — تُحفظ مستقلة حتى لا يفقدها أي حفظ لاحق للإعدادات. */
  matchStreams?: Record<string, string>;
}

export interface Config {
  singleRate: number;
  multiRate: number;
  gameRate: number;
  matchViewingRate: number;
  currency: string;
  /** اسم الموقع/المحل — يظهر ديناميكياً في رأس التطبيق (يمكن تغييره من لوحة الإدارة). */
  siteName: string;
  /** وضع الصيانة: عند التفعيل، يُمنع الموظفون (staff) من تسجيل الدخول أو المتابعة، ويبقى الوصول متاحاً للمدير (admin) فقط. */
  maintenanceMode: boolean;
  /** رابط شعار الموقع المخصص (مرفوع من لوحة الإدارة). */
  logoUrl: string;
  /** رابط صورة الجهاز (بلايستيشن/شاشة) المخصص — تُعرض كقطعة مركزية أعلى عداد كل جهاز. فارغة = الرسم الافتراضي. */
  deviceGraphicUrl: string;
  /** أزرار الإيرادات السريعة في الشريط العلوي — قائمة ديناميكية تُدار من لوحة الإدارة. */
  quickIncomeButtons: QuickIncomeButton[];
  /** ملفات أصوات التنبيهات الستة (HTML5 Audio) — تُدار من لوحة الإدارة. */
  alertSounds: AlertSounds;
  /** أصوات تنبيهات مخصصة لكل جهاز (مفتاح = Device.id) — تُضاف فوق الأصوات الافتراضية العامة؛
   *  أي حدث بلا رابط مخصص يعود تلقائياً للصوت العام (global). */
  deviceAlertSounds?: Record<string, Partial<AlertSounds>>;
  /** إعدادات بنر المباريات والتنبيهات الصوتية المرتبطة بها. */
  matches?: MatchSettings;
}

/** نوع الإيرادات المسجّلة من أزرار الإيرادات السريعة — يتطابق مع أصناف المالية في الورديات. */
export type IncomeStream = 'fawry' | 'printer' | 'matchViewing' | 'misc';

/** درجات الألوان المتاحة لأزرار الإيرادات السريعة. */
export type IncomeTone = 'blue' | 'green' | 'amber' | 'purple' | 'red';

/** زر إيراد سريع واحد (افتراضي داخلي أو مُضاف يدوياً من لوحة الإدارة). */
export interface QuickIncomeButton {
  id: string;
  label: string;
  icon: string; // إيموجي يظهر داخل الزر
  tone: IncomeTone;
}

export const DEFAULT_QUICK_INCOME: QuickIncomeButton[] = [
  { id: 'fawry', label: 'فوري', icon: '💳', tone: 'blue' },
  { id: 'printer', label: 'الطابعة', icon: '🖨', tone: 'purple' },
  { id: 'matchViewing', label: 'مشاهدة مباريات', icon: '⚽', tone: 'green' },
];

/** الصنف المالي الذي تُسجَّل عليه كل أزرار الإيرادات السريعة بدون اختيار من المستخدم:
 *  الأزرار الافتراضية الثلاثة تحتفظ بأصنافها التاريخية (فوري/طابعة/مباريات) ليستمر عمل التقارير،
 *  وكل زر مخصص يقع تلقائياً في فئة "إيراد آخر" الموحّدة. */
export function incomeStreamOf(id: string): IncomeStream {
  return id === 'fawry' ? 'fawry' : id === 'printer' ? 'printer' : id === 'matchViewing' ? 'matchViewing' : 'misc';
}

export interface Device {
  id: string;
  number: number;
  name: string;
}

export interface OrderItem {
  itemId: string;
  name: string;
  price: number;
  qty: number;
  category: ItemCategory;
  /** إجمالي الخصم المنسوب لهذا السطر (يُحفظ عند إضافة طلب جلسة للجهاز مع خصم) — غير موجود أو صفر = بلا خصم. */
  discount?: number;
}

/** المبلغ الصافي لسطر طلب بعد الخصم المنسوب إليه — يُستخدم في الفوترة والتحصيل والتقارير. */
export function orderLineNet(o: OrderItem): number {
  return Math.max(0, o.price * o.qty - (o.discount ?? 0));
}

export interface Session {
  id: string;
  deviceId: string;
  deviceName: string;
  type: SessionType;
  rateType: RateType;
  limitedMinutes: number;
  gamesCount: number;
  startedAt: number; // epoch ms (client clock, synced on start)
  endedAt?: number | null; // epoch ms at settlement/cancellation — يُستخدم لتحليل أوقات الذروة
  status: SessionStatus;
  orders: OrderItem[];
  discount: number;
  serviceFee: number;
  total: number;
  staff: string;
  shiftId: string | null;
  paused: boolean;
  pausedAt: number | null; // epoch ms when the current pause started, null when running
  pausedMs: number; // total accumulated paused duration, excluded from time/cost calculations
  collected?: boolean; // هل تم تحصيل المبلغ (علامة مرئية فقط — لا تؤثر على الفوترة)
}

export interface InventoryItem {
  id: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  category: ItemCategory;
}

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  pin: string;
  role: Role;
  /** رابط صورة الملف الشخصي للمستخدم (افتراضياً غير موجود = أيقونة تلقائية). */
  avatarUrl?: string;
}

export interface Shift {
  id: string;
  staff: string;
  role: Role;
  startedAt: number;
  endedAt: number | null;
  openingFloat: number;
  sessionCash: number;
  storeCash: number;
  fawryCash: number;
  printerCash: number;
  matchViewingCash: number;
  miscCash?: number;
  /** تفصيل الإيرادات الأخرى حسب اسم الزر (source) — يُحفظ عند التقفيل للاطلاع عليه لاحقاً في تقارير الورديات. */
  miscBySource?: Record<string, number>;
  withdrawals: number;
  /** إجمالي الإضافات النقدية المفعّلة داخل الوردية (بعد انتهاء مهلة التأجيل) — تُحفظ عند التقفيل. */
  deposits?: number;
  total: number;
  status: 'open' | 'closed';
  /** إيراد أجهزة اللعب الصافي (وقت اللعب فقط — بدون مشتريات/طلبات) — يُحفظ عند التقفيل. */
  sessionTimeCash?: number;
  /** صافي إيراد المأكولات داخل الوردية (بيع مباشر + طلبات الجلسات) — يُحفظ عند التقفيل. */
  foodCash?: number;
  /** صافي إيراد المشروبات داخل الوردية (بيع مباشر + طلبات الجلسات) — يُحفظ عند التقفيل. */
  drinksCash?: number;
  /** عدد الجلسات الملقاة دون تحصيل داخل الوردية — يُعدّ عند التقفيل فقط. */
  cancelledCount?: number;
}

/**
 * سجل تقرير وردية محفوظ — يُنشأ تلقائياً عند رفض إشعار «تقرير/نهاية الوردية» من جرس
 * إشعارات الورديات (المدير)، ويظهر في قسم «تقارير الورديات» بلوحة الإدارة مع زر إظهار
 * التقرير الكامل وحذف دائم للرقم من قاعدة البيانات. رقمه (id) هو نفس رقم الوردية.
 */
export interface ShiftReport {
  id: string;
  staff: string;
  role: Role;
  startedAt: number;
  endedAt: number | null;
  openingFloat: number;
  /** صافي إيراد الوردية (الإجمالي المحفوظ عند التقفيل). */
  total: number;
  createdAt: number;
}

/** نوع حركة الخزنة النقدية — سحب من الدرج أو إضافة نقد إليها. */
export type CashMoveType = 'withdraw' | 'deposit';

/** حالة تفعيل حركة الخزنة — السحب يُفعَّل فوراً، والإضافة تبقى «قيد التفعيل» حتى انتهاء مهلة التأجيل. */
export type CashMoveStatus = 'active' | 'pending';

/**
 * حركة نقدية موحّدة (سحب/إضافة) من درج الخزنة أثناء الوردية — كل عملية تُسجل كسجل مستقل
 * باسم الموظف المنفذ، وتؤثر صافياً على الإيراد عند التقفيل.
 */
export interface Withdrawal {
  id: string;
  shiftId: string;
  staff: string;
  amount: number;
  note?: string;
  at: number;
  /** نوع الحركة: 'withdraw' (سحب) أو 'deposit' (إضافة). السجلات القديمة بلا حقل تُعامل كسحب. */
  type?: CashMoveType;
  /** حالة التفعيل: 'active' للحساب الفوري، 'pending' للإضافات خلال مهلة التأجيل. */
  status?: CashMoveStatus;
  /** وقت التفعيل — السحب = وقت التسجيل، والإضافة = وقت التسجيل + دقيقتين. */
  activateAt?: number;
}

/** زبون مسجل في دفتر الزبائن — يُستخدم للعروض والمراسلة عبر Messenger/WhatsApp. */
export interface Customer {
  id: string;
  name: string;        // اسم الزبون (إلزامي)
  phone: string;       // رقم الهاتف (اختياري)
  facebookUrl: string; // رابط الفيسبوك/الماسنجر (اختياري)
  notes: string;       // ملاحظات (اختياري)
  createdAt: number;   // تاريخ التسجيل
}

/** فئات المبيعات: جلسات الأجهزة، بيع مباشر من المخزون، إيراد ماكنة فوري، إيراد الطابعة، مشاهدة المباريات، إيرادات أخرى. */
export type SaleType = 'session' | 'store' | 'fawry' | 'printer' | 'matchViewing' | 'misc';

export interface Sale {
  id: string;
  type: SaleType;
  deviceId: string | null;
  deviceName: string | null;
  sessionType: SessionType | null;
  rateType: RateType | null;
  minutes: number;
  timeCost: number;
  gamesCount: number;
  gamesCost: number;
  controllerCost?: number; // legacy records only
  orders: OrderItem[];
  itemsTotal: number;
  subtotal: number;
  discount: number;
  /** صافي الخصم المنسوب لكل فئة (خصم المأكولات / خصم المشروبات) — يُطبَّق الاثنان معاً عند الحاجة،
   *  ويُمكّن تقارير الأصناف من عرض صافي الإيراد بدقة. */
  discountByCategory?: Partial<Record<ItemCategory, number>>;
  serviceFee: number;
  total: number;
  staff: string;
  shiftId: string | null;
  at: number;
  note?: string; // وصف اختياري لعمليات فوري/الطابعة
  source?: string; // اسم زر الإيراد السريع الذي أنشأ العملية
  /** وقت بدء الجلسة الفعلي (جلسات الأجهزة فقط) — للدلالة على إحصائيات استخدام الأجهزة. */
  startedAt?: number;
}

export const DEFAULT_CONFIG: Config = {
  singleRate: 10,
  multiRate: 15,
  gameRate: 15,
  matchViewingRate: 10,
  currency: 'جنيه',
  siteName: 'بلايستيشن أحمد الشريف',
  maintenanceMode: false,
  logoUrl: '',
  deviceGraphicUrl: '',
  quickIncomeButtons: DEFAULT_QUICK_INCOME,
  // روابط اختبار جاهزة للعمل فوراً لحدثي البداية والانتهاء؛ ويمكن استبدالها أو تفريغها من
  // لوحة الإدارة (القيمة الفارغة تعني "بدون صوت" لهذا الحدث).
  alertSounds: {
    sessionStarted: 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars3.wav',
    sessionExpired: 'https://www2.cs.uic.edu/~i101/SoundFiles/taunt.wav',
    almostUp: '',
    sessionExtended: '',
    sessionCancelled: '',
    paymentCollected: '',
    sessionPaused: '',
    sessionResumed: '',
  },
  deviceAlertSounds: {},
  matches: {
    audioEnabled: true,
    alertIntervalMin: 30,
    manualMatches: [],
    matchStreams: {},
  },
};

export function classifyItem(name: string): ItemCategory {
  const foodHints = ['إندومي', 'اندومي', 'شاورما', 'برجر', 'بيتزا', 'سندويتش', 'بطاطس', 'فول', 'طعمية'];
  return foodHints.some((h) => name.includes(h)) ? 'food' : 'drinks';
}

/** أنظمة بطولات البلايستيشن: خروج المغلوب المباشر (أحادية الإقصاء) أو نظام المجموعات بصعود أول مركزين. */
export type TournamentFormat = 'knockout' | 'groups';

/** مرحلة الدورة: بلا قرعة / دور المجموعات / مرحلة الإقصاء (شجرة) / منتهية (تحدّد الفائز). */
export type TournamentStage = 'pending' | 'groups' | 'playoff' | 'done';

/** مباراة واحدة داخل شجرة الإقصاء أو داخل مجموعة. */
export interface TournamentMatch {
  id: string;
  /** عنوان المرحلة المعروض في شجرة الإقصاء (دور الـ 16 / ربع النهائي / النهائي …). */
  label: string;
  /** رقم الجولة: 0 = أول جولة تُلعب داخل الشجرة، ويصعد مع العمق نحو النهائي. */
  round: number;
  /** موضع المباراة داخل جولتها — يُستعمل لربط تقدم الفائز إلى المواجهة التالية. */
  bracketIndex: number;
  playerA?: string;
  playerB?: string;
  scoreA?: number;
  scoreB?: number;
  /** الفائز — يتقدم تلقائياً إلى مقعد المواجهة التالية في الشجرة. */
  winner?: string;
  /** معرّف المجموعة لمباريات دور المجموعات (A/B/C/D…). */
  groupId?: string;
  /** حُسمت المباراة تلقائياً (تأهل هذا اللاعب دون خصم — BYE). */
  auto?: boolean;
}

/** مجموعة واحدة في دور المجموعات. */
export interface TournamentGroup {
  id: string;          // 'A' | 'B' | 'C' | …
  name: string;        // «المجموعة أ»
  players: string[];
  matches: TournamentMatch[];
  /** نتيجة قرعة حسم التكافؤ (عند تساوي النقاط وفرق الأهداف): خريطة اللاعب → قيمة الحسم الأصغر يرتّب أعلى. */
  tiebreak?: Record<string, number>;
}

/**
 * قرعة حالية معلّقة للعرض اللحظي على كل الشاشات — تُكتب إلى Firestore في لحظة بدء القرعة
 * (بمصدر وقت موحّد `startedAt`) ثم تُزال عند اكتمال الظهور، فيحسب كل متصفح نسبة التقدّم
 * بالاعتماد على ساعته المحلية بنفس إيقاع 2000 مللي ثانية لكل مقعد.
 *   • kind = 'draw'   : سحب أولي (خروج مغلوب له bracket، أو مجموعات لها groups).
 *   • kind = 'playoff': بناء مرحلة الإقصاء بعد المجموعات (الشجرة فقط — المجموعات خلفية ثابتة).
 *   • kind = 'tie'    : قرعة حسم تكافؤ داخل مجموعة (بدون صفّي/مباريات — قائمة ترتيب فقط).
 */
export interface TournamentReveal {
  kind: 'draw' | 'playoff' | 'tie';
  /** طابع زمني موحّد لبدء الظهور (epoch ms) — يحدد `total` مقاعد يُكشف كلٌّ منها كل 2000ms. */
  startedAt: number;
  total: number;
  /** ترتيب ظهور اللاعبين داخل مجموعاتهم (نظام المجموعات فقط). */
  playerOrder?: { gId: string; player: string }[];
  /** ترتيب ظهور مقاعد مباريات المجموعات (A ثم B لكل مباراة). */
  matchOrder?: { gId: string; matchId: string; side: 'A' | 'B' }[];
  /** بيانات قرعة الحسم: معرف المجموعة وترتيب السحب العشوائي للمتعادلين. */
  tie?: { groupId: string; order: string[] };
}

/** دورة بلايستيشن كاملة — تُخزَّن بالكامل في Firestore (مجموعة tournaments) وتُستأنف/تُتابع عبر الاشتراك اللحظي. */
export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  participants: string[];
  stage: TournamentStage;
  /** شجرة خروج المغلوب: لدور الإقصاء المباشر، أو لمرحلة الإقصاء بعد دور المجموعات. */
  bracket: TournamentMatch[];
  groups: TournamentGroup[];
  /** قرعة معلّقة تعرضها الشاشات لحظياً — تُكتب عند بدء القرعة وتُمسح عند اكتمالها. */
  reveal?: TournamentReveal | null;
  createdAt: number;
  updatedAt: number;
}
