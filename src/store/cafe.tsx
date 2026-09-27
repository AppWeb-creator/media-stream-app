import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  db, storage,
} from '../lib/firebase';
import {
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, increment, getDocs, writeBatch,
} from 'firebase/firestore';
import type { Query, DocumentData } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type {
  AppUser, Config, Customer, Device, IncomeStream, InventoryItem, ItemCategory, OrderItem, Role, Sale, SaleType, Session, Shift, ShiftReport, User, Withdrawal,
  SessionType, RateType, CashMoveType, Tournament, TournamentFormat,
} from '../lib/types';
import { DEFAULT_CONFIG, classifyItem, orderLineNet } from '../lib/types';
import {
  alertSessionStarted, alertCash, alertTimeExpired, alertTimeAlmostUp, alertExtended,
  alertSessionCancelled, alertPaymentCollected, stopUrgentAlarms, alertSessionPaused, alertSessionResumed,
  alertShiftOpen, alertShiftClose,
  isAlarmActive, subscribeAlarmActive, configureAlertSounds,
} from '../lib/audio';
import { printReceipt, printOrderTicket } from '../lib/receipt';

/** المدة الفعلية المنقضية للجلسة بعد خصم فترات الإيقاف المؤقت — تُجمَّد وقت الإيقاف. */
export function elapsedMs(s: Session, now: number): number {
  const pausedMs = s.pausedMs ?? 0;
  if (s.paused && s.pausedAt) return Math.max(0, s.pausedAt - s.startedAt - pausedMs);
  return Math.max(0, now - s.startedAt - pausedMs);
}

interface StoreState {
  ready: boolean;
  online: boolean;
  user: User | null;
  config: Config;
  devices: Device[];
  sessions: Session[]; // active sessions keyed by id
  inventory: InventoryItem[];
  openShifts: Shift[];
  myOpenShift: Shift | null;
  anyOpenShift: Shift | null;
  shifts: Shift[];
  sales: Sale[];
  withdrawals: Withdrawal[];
  users: AppUser[];
  customers: Customer[];
  shiftReports: ShiftReport[];
  tournaments: Tournament[];
}

/**
 * تنظيف عميق على مستوى الوحدة: يزيل كل مفتاح قيمته `undefined` على كل المستويات (كائنات ومصفوفات)
 * لأن setDoc يرفض `undefined` تماماً — يُبقى null كما هو. يُستخدم لحفظ المباريات اليدوية (قد تحمل
 * حقولاً فارغة مثل الشعارات/رابط البث) قبل كتابتها في المستند حتى لا يرفضها Firestore فتختفي المباراة.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * دالة تنظيف مستقلة (على مستوى الوحدة، لا طريقة في المتجر): تبني نسخة عميقة من كائن الدورة
 * تناسب Firestore — تُحذف كل مفتاح قيمته `undefined` (مثل مقاعد BYE الفارغة {"‎‏BYE"} ونتائج غير
 * المسجَّلة) لأن setDoc يرفض `undefined` تماماً. يُحذف أيضاً كل مستوى من الكائن، ويبقى null كما هو.
 * نسمّيها مباشرة في saveTournament (بدون `this` وبدون get()) فلا تكسر عندما تُسحب الدالة من المتجر. */
function cleanTournament(t: Tournament): Tournament {
  return stripUndefined(t);
}

interface StoreApi extends StoreState {
  /** يعيد null عند النجاح، أو رسالة خطأ واضحة للعرض (بيانات خاطئة أو حساب متوقف بسبب وضع الصيانة). */
  login: (username: string, pin: string) => string | null;
  logout: () => void;
  startSession: (deviceId: string, type: SessionType, rateType: RateType, limitedMinutes: number) => Promise<void>;
  settleSession: (session: Session, discount: number, serviceFee: number, print: boolean) => Promise<void>;
  cancelSession: (session: Session) => Promise<void>;
  extendSession: (session: Session, extraMinutes: number) => Promise<void>;
  pauseSession: (session: Session) => Promise<void>;
  resumeSession: (session: Session) => Promise<void>;
  markCollected: (session: Session) => Promise<void>;
  addOrders: (session: Session, items: { itemId: string; qty: number }[], foodDiscount?: number, drinksDiscount?: number, print?: boolean) => Promise<void>;
  directStoreSale: (items: { itemId: string; qty: number }[], print: boolean, foodDiscount?: number, drinksDiscount?: number) => Promise<void>;
  addIncome: (stream: IncomeStream, amount: number, note: string, print: boolean, source?: string) => Promise<void>;
  addDevice: (name: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  addInventoryItem: (name: string, price: number, cost: number, stock: number, category: ItemCategory) => Promise<void>;
  updateInventoryItem: (id: string, patch: Partial<Pick<InventoryItem, 'name' | 'price' | 'cost' | 'stock' | 'category'>>) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  updateConfig: (patch: Partial<Config>) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
  deleteShift: (id: string) => Promise<void>;
  deleteWithdrawal: (id: string) => Promise<void>;
  saveShiftReport: (shift: Shift) => Promise<void>;
  deleteShiftReport: (id: string) => Promise<void>;
  createTournament: (name: string, format: TournamentFormat, participants: string[]) => Promise<string>;
  saveTournament: (t: Tournament) => Promise<void>;
  deleteTournament: (id: string) => Promise<void>;
  deleteOldSales: (olderThanDays: number) => Promise<number>;
  deleteAllSales: () => Promise<number>;
  addUser: (displayName: string, username: string, pin: string, role: Role) => Promise<void>;
  updateUser: (id: string, patch: Partial<Pick<AppUser, 'displayName' | 'username' | 'pin' | 'role' | 'avatarUrl'>>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  addCustomer: (name: string, phone: string, facebookUrl: string, notes: string) => Promise<void>;
  updateCustomer: (id: string, patch: Partial<Pick<Customer, 'name' | 'phone' | 'facebookUrl' | 'notes'>>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  startShift: (openingFloat: number) => Promise<void>;
  closeShift: () => Promise<void>;
  moveCash: (type: CashMoveType, amount: number, note: string) => Promise<void>;
  uploadSiteImage: (file: File) => Promise<string>;
  timeCostOf: (session: Session, now: number) => { minutes: number; cost: number };
  subtotalOf: (session: Session, now: number) => { timeCost: number; gamesCost: number; ordersTotal: number; subtotal: number };
}

const StoreContext = createContext<StoreApi | null>(null);

const AUTH_KEY = 'pscafe.auth';

/** صلاحية العرض: الموظف يرى عملياته فقط، والمدير يرى كل شيء. */
export function canViewRecord(user: User | null, recordStaff: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return recordStaff === user.displayName || recordStaff === user.username;
}

/** توزيع خصمي المأكولات والمشروبات (يُسمح بتطبيقهما معاً في نفس الطلب) على سطور الطلب الجديد
 *  لكل فئة على حدة ونسبياً حسب قيمة كل سطر — ويُحفظ صافي المبلغ على السطور فيصبح الإجمالي
 *  تلقائياً صافياً في الفوترة والتقارير. */
function applyOrderDiscount(
  orders: OrderItem[],
  lines: OrderItem[],
  foodDiscount: number,
  drinksDiscount: number,
): OrderItem[] {
  const patched = [...orders];
  (['food', 'drinks'] as ItemCategory[]).forEach((cat) => {
    const disc = cat === 'food' ? foodDiscount : drinksDiscount;
    if (!disc || disc <= 0) return;
    const grossOf = (l: OrderItem) => l.price * l.qty;
    const poolLines = lines.filter((l) => l.category === cat);
    const pool = poolLines.reduce((s, l) => s + grossOf(l), 0);
    if (pool <= 0) return;
    const capped = Math.min(disc, pool);
    const shares = poolLines.map((l) => Math.round((grossOf(l) * capped) / pool * 100) / 100);
    const given = shares.reduce((a, b) => a + b, 0);
    shares[shares.length - 1] = Math.round((shares[shares.length - 1] + (capped - given)) * 100) / 100;
    poolLines.forEach((l, i) => {
      const idx = patched.findIndex((o) => o.itemId === l.itemId);
      if (idx >= 0 && shares[i] > 0) {
        patched[idx] = { ...patched[idx], discount: Math.round(((patched[idx].discount ?? 0) + shares[i]) * 100) / 100 };
      }
    });
  });
  return patched;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<User>) : null;
      if (!parsed?.username || !parsed?.role || !parsed?.displayName) return null;
      return { username: parsed.username, displayName: parsed.displayName, role: parsed.role, avatarUrl: parsed.avatarUrl };
    } catch {
      return null;
    }
  });
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);

  // ربط إعدادات الأصوات (العامة + المخصصة لكل جهاز) من لوحة الإدارة بمنظومة الصوت المركزية.
  useEffect(() => {
    configureAlertSounds(config.alertSounds || DEFAULT_CONFIG.alertSounds, config.deviceAlertSounds || {});
  }, [config]);

  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [openShifts, setOpenShifts] = useState<Shift[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shiftReports, setShiftReports] = useState<ShiftReport[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  const onlineRef = useRef(true);
  const seeded = useRef(false);
  const devicesMigrated = useRef(false);
  const inventoryMigrated = useRef(false);
  const usersSeeded = useRef(false);

  /** One-time, idempotent first-run seed (deterministic doc IDs). */
  const seedDefaults = async (): Promise<void> => {
    const names = ['بلايستيشن 4 #1', 'بلايستيشن 4 #2', 'بلايستيشن 4 #3', 'بلايستيشن 4 #4'];
    for (let i = 0; i < names.length; i++) {
      await setDoc(doc(db, 'devices', `dev-${i + 1}`), { number: i + 1, name: names[i] });
    }
    const items: [string, string, number, number, number, ItemCategory][] = [
      ['itm-indomie', 'إندومي', 20, 12, 50, 'food'],
      ['itm-cola', 'كولا', 15, 9, 50, 'drinks'],
      ['itm-sprite', 'سبرايت', 15, 9, 40, 'drinks'],
      ['itm-water', 'مياه معدنية', 10, 5, 60, 'drinks'],
    ];
    for (const [id, name, price, cost, stock, category] of items) {
      await setDoc(doc(db, 'inventory', id), { name, price, cost, stock, category });
    }
  };

  /** ترحيل أسماء الأجهزة القديمة (بلايستيشن 5) إلى بلايستيشن 4. */
  const migrateDeviceNames = async (rows: Device[]): Promise<void> => {
    for (const d of rows) {
      if (d.name.includes('بلايستيشن 5') || d.name.includes('PS5')) {
        const newName = d.name.replace('بلايستيشن 5', 'بلايستيشن 4').replace('PS5', 'بلايستيشن 4');
        await updateDoc(doc(db, 'devices', d.id), { name: newName });
      }
    }
  };

  /** ترحيل المخزون القديم: إضافة التصنيف (مشروبات/مأكولات) للمنتجات التي بدونه. */
  const migrateInventoryCategories = async (rows: InventoryItem[]): Promise<void> => {
    for (const item of rows) {
      if (!item.category) {
        await updateDoc(doc(db, 'inventory', item.id), { category: classifyItem(item.name) });
      }
    }
  };

  /** بذرة الحسابات الافتراضية عند أول تشفيل: مدير وموظف بنفس البيانات الموجودة مسبقاً. */
  const seedUsers = async (): Promise<void> => {
    await setDoc(doc(db, 'users', 'usr-admin'), { username: 'admin', displayName: 'أحمد الشريف', pin: '155148', role: 'admin' });
    await setDoc(doc(db, 'users', 'usr-staff'), { username: 'staff', displayName: 'أحمد حسين', pin: '2027', role: 'staff' });
  };

  // ---- real-time subscriptions ----
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    let pending = 4;
    const mark = () => {
      pending -= 1;
      if (pending <= 0) setReady(true);
    };

    unsubs.push(onSnapshot(doc(db, 'config', 'main'), (snap) => {
      if (snap.exists()) setConfig({ ...DEFAULT_CONFIG, ...(snap.data() as Config) });
      else void setDoc(doc(db, 'config', 'main'), DEFAULT_CONFIG);
      mark();
    }, (err) => { console.error('config', err); setOnline(false); mark(); }));

    unsubs.push(onSnapshot(collection(db, 'devices'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Device, 'id'>) }));
      rows.sort((a, b) => a.number - b.number);
      setDevices(rows);
      if (!seeded.current && rows.length === 0) {
        seeded.current = true;
        void seedDefaults();
      } else if (!devicesMigrated.current && rows.length > 0) {
        devicesMigrated.current = true;
        void migrateDeviceNames(rows);
      }
      mark();
    }, (err) => { console.error('devices', err); setOnline(false); mark(); }));

    unsubs.push(onSnapshot(collection(db, 'inventory'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, 'id'>) }));
      setInventory(rows);
      if (!inventoryMigrated.current && rows.length > 0) {
        inventoryMigrated.current = true;
        void migrateInventoryCategories(rows);
      }
      mark();
    }, (err) => { console.error('inventory', err); setOnline(false); mark(); }));

    unsubs.push(onSnapshot(query(collection(db, 'sessions'), where('status', '==', 'active')), (snap) => {
      setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) })));
    }, (err) => console.error('sessions', err)));

    unsubs.push(onSnapshot(query(collection(db, 'shifts'), where('status', '==', 'open')), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shift, 'id'>) }));
      rows.sort((a, b) => a.startedAt - b.startedAt);
      setOpenShifts(rows);
    }, (err) => console.error('openShifts', err)));

    unsubs.push(onSnapshot(query(collection(db, 'shifts'), orderBy('startedAt', 'desc'), limit(60)), (snap) => {
      setShifts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shift, 'id'>) })));
    }, (err) => console.error('shifts', err)));

    unsubs.push(onSnapshot(query(collection(db, 'sales'), orderBy('at', 'desc'), limit(300)), (snap) => {
      setSales(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Sale, 'id'>) })));
    }, (err) => console.error('sales', err)));

    unsubs.push(onSnapshot(query(collection(db, 'withdrawals'), orderBy('at', 'desc'), limit(300)), (snap) => {
      setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Withdrawal, 'id'>) })));
    }, (err) => console.error('withdrawals', err)));

    unsubs.push(onSnapshot(query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })));
    }, (err) => console.error('customers', err)));

    unsubs.push(onSnapshot(collection(db, 'shiftReports'), (snap) => {
      setShiftReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShiftReport, 'id'>) })));
    }, (err) => console.error('shiftReports', err)));

    // بطولات البلايستيشن — تُقرأ/تُسند اللحظي بالكامل: كل دورة (بشجرتها ومجموعاتها) مستند واحد قابل للاستئناف.
    unsubs.push(onSnapshot(query(collection(db, 'tournaments'), orderBy('createdAt', 'desc'), limit(100)), (snap) => {
      setTournaments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tournament, 'id'>) })));
    }, (err) => console.error('tournaments', err)));

    unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppUser, 'id'>) }));
      setUsers(rows);
      if (!usersSeeded.current && rows.length === 0) {
        usersSeeded.current = true;
        void seedUsers();
      }
      mark();
    }, (err) => { console.error('users', err); setOnline(false); mark(); }));

    const handle = () => setOnline(navigator.onLine);
    window.addEventListener('online', handle);
    window.addEventListener('offline', handle);

    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener('online', handle);
      window.removeEventListener('offline', handle);
    };
  }, []);

  // connection indicator follows firestore snapshot errors too
  useEffect(() => {
    setOnline(navigator.onLine && onlineRef.current);
  }, [online]);

  const api = useMemo<StoreApi>(() => {
    // وردية المستخدم الحالية: كل مستخدم يرى وردية هو فقط، ولا يرى وردية الطرف الآخر
    const myOpenShift: Shift | null = user
      ? openShifts.find((s) => s.staff === user.displayName || s.staff === user.username) ?? null
      : null;
    const anyOpenShift: Shift | null = openShifts[0] ?? null;

    const requireShift = (): Shift => {
      if (!myOpenShift) throw new Error('لا توجد وردية مفتوحة. الرجاء فتح وردية أولاً.');
      return myOpenShift;
    };

    const timeCostOf = (s: Session, now: number): { minutes: number; cost: number } => {
      const elapsedMin = Math.max(0, Math.ceil(elapsedMs(s, now) / 60000));
      // الجلسة المحدودة: تُقيَّد الفترة القابلة للاحتساب بسقف المدة المحددة — تتوقف التكلفة فور انتهاء الوقت.
      const minutes =
        s.type === 'limited' && s.limitedMinutes > 0 ? Math.min(elapsedMin, s.limitedMinutes) : elapsedMin;
      if (s.rateType === 'game') {
        return { minutes, cost: (s.gamesCount ?? 0) * config.gameRate };
      }
      const rate = s.rateType === 'multi' ? config.multiRate : config.singleRate;
      return { minutes, cost: (minutes / 60) * rate };
    };

    const subtotalOf = (s: Session, now: number) => {
      const { cost } = timeCostOf(s, now);
      const gamesCost = s.rateType === 'game' ? cost : 0;
      const ordersTotal = s.orders.reduce((sum, o) => sum + orderLineNet(o), 0);
      return { timeCost: s.rateType === 'game' ? 0 : cost, gamesCost, ordersTotal, subtotal: cost + ordersTotal };
    };

    const writeSale = async (sale: Omit<Sale, 'id'>): Promise<string> => {
      const ref = await addDoc(collection(db, 'sales'), sale);
      return ref.id;
    };

    const shiftTotals = async (
      shiftId: string,
    ): Promise<{ sessionCash: number; storeCash: number; fawryCash: number; printerCash: number; matchViewingCash: number; miscCash: number; miscBySource: Record<string, number>; withdrawals: number; deposits: number; sessionTimeCash: number; foodCash: number; drinksCash: number }> => {
      // aggregated client-side from live sales; falls back to a fetch for older sales
      let sessionCash = 0;
      let storeCash = 0;
      let fawryCash = 0;
      let printerCash = 0;
      let matchViewingCash = 0;
      let miscCash = 0;
      // إيراد أجهزة اللعب الصافي (وقت اللعب فقط — بدون المشتريات/الطلبات).
      let sessionTimeCash = 0;
      // صافي إيراد الأصناف داخل الوردية من كل الفواتير (بيع مباشر + طلبات الجلسات).
      let foodCash = 0;
      let drinksCash = 0;
      const miscBySource: Record<string, number> = {};
      let got = sales.filter((s) => s.shiftId === shiftId);
      if (got.length === 0) {
        const q = query(collection(db, 'sales'), where('shiftId', '==', shiftId), limit(500));
        const res = await getDocs(q);
        got = res.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Sale, 'id'>) }));
      }
      for (const s of got) {
        if (s.type === 'session') {
          sessionCash += s.total;
          sessionTimeCash += s.timeCost + (s.gamesCost ?? 0);
        }
        else if (s.type === 'fawry') fawryCash += s.total;
        else if (s.type === 'printer') printerCash += s.total;
        else if (s.type === 'matchViewing') matchViewingCash += s.total;
        else if (s.type === 'misc') {
          miscCash += s.total;
          const k = (s.source && s.source.trim()) || 'إيراد آخر';
          miscBySource[k] = (miscBySource[k] || 0) + s.total;
        } else storeCash += s.total;
        // تجميع صافي إيراد الأصناف (مأكولات/مشروبات) من كل الفواتير — خصم السطر يُطرح مباشرة
        // من قيمة السطر، وخصم فئة البيع المباشر يُطرح من إجمالي فئته على مستوى الفاتورة.
        let saleFood = 0;
        let saleDrinks = 0;
        for (const o of s.orders) {
          const cat: ItemCategory = o.category ?? classifyItem(o.name);
          const net = orderLineNet(o);
          if (cat === 'food') saleFood += net;
          else saleDrinks += net;
        }
        if (s.type === 'store') {
          saleFood = Math.max(0, saleFood - (s.discountByCategory?.food ?? 0));
          saleDrinks = Math.max(0, saleDrinks - (s.discountByCategory?.drinks ?? 0));
        }
        foodCash += Math.round(saleFood * 100) / 100;
        drinksCash += Math.round(saleDrinks * 100) / 100;
      }
      let withdrawalsCash = 0;
      let depositsCash = 0;
      let wd = withdrawals.filter((w) => w.shiftId === shiftId);
      if (wd.length === 0) {
        const q = query(collection(db, 'withdrawals'), where('shiftId', '==', shiftId), limit(500));
        const res = await getDocs(q);
        wd = res.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Withdrawal, 'id'>) }));
      }
      // المبالغ التي انتهت مهلة تفعيلها فقط تُحتسب (الإضافات قيد التأجيل لا تُدخل في الأرقام الآن).
      const activateCutoff = Date.now();
      for (const w of wd) {
        if (w.activateAt && w.activateAt > activateCutoff) continue;
        if ((w.type ?? 'withdraw') === 'deposit') depositsCash += w.amount || 0;
        else withdrawalsCash += w.amount || 0;
      }
      return { sessionCash, storeCash, fawryCash, printerCash, matchViewingCash, miscCash, miscBySource, withdrawals: withdrawalsCash, deposits: depositsCash, sessionTimeCash, foodCash, drinksCash };
    };

    /** يحذف كل مستندات الاستعلام في دفعات متلاحقة (يلتف حد 500 عملية لكل دفعة في Firestore). */
    const purgeQuery = async (q: Query<DocumentData>): Promise<number> => {
      let deleted = 0;
      for (;;) {
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 450) break;
      }
      return deleted;
    };

    return {
      ready, online, user, config, devices, sessions, inventory, openShifts, myOpenShift, anyOpenShift, shifts, sales, withdrawals, users, customers, shiftReports, tournaments,

      login: (username, pin) => {
        const uname = username.trim().toLowerCase();
        const u = users.find((x) => x.username.trim().toLowerCase() === uname && x.pin === pin);
        if (!u) return 'اسم المستخدم أو رمز الدخول غير صحيح';
        if (config.maintenanceMode && u.role !== 'admin') {
          return 'النظام في وضع الصيانة حالياً — الدخول متاح للمدير فقط. يرجى المحاولة لاحقاً.';
        }
        const nu: User = { username: u.username, displayName: u.displayName, role: u.role, avatarUrl: u.avatarUrl };
        setUser(nu);
        localStorage.setItem(AUTH_KEY, JSON.stringify(nu));
        return null;
      },

      logout: () => {
        setUser(null);
        localStorage.removeItem(AUTH_KEY);
      },

      async startSession(deviceId, type, rateType, limitedMinutes) {
        const shift = requireShift();
        const device = devices.find((d) => d.id === deviceId);
        if (!device) throw new Error('الجهاز غير موجود');
        if (sessions.some((s) => s.deviceId === deviceId)) throw new Error('هذا الجهاز لديه جلسة نشطة بالفعل');
        // نظام "جيم واحد": جلسة محدودة تلقائياً بـ 20 دقيقة وتُحتسب جيماً واحداً
        const isGame = rateType === 'game';
        const session: Omit<Session, 'id'> = {
          deviceId, deviceName: device.name, type: isGame ? 'limited' : type, rateType,
          limitedMinutes: isGame ? 20 : type === 'limited' ? limitedMinutes : 0,
          gamesCount: isGame ? 1 : 0, startedAt: Date.now(), status: 'active',
          orders: [], discount: 0, serviceFee: 0, total: 0,
          staff: user?.displayName ?? 'غير معروف', shiftId: shift.id,
          paused: false, pausedAt: null, pausedMs: 0,
        };
        const ref = await addDoc(collection(db, 'sessions'), session);
        alertSessionStarted(device.id, ref.id);
      },

      async settleSession(s, discount, serviceFee, print) {
        const now = Date.now();
        const { minutes, cost } = timeCostOf(s, now);
        const timeCost = s.rateType === 'game' ? 0 : cost;
        const gamesCost = s.rateType === 'game' ? cost : 0;
        const ordersTotal = s.orders.reduce((sum, o) => sum + orderLineNet(o), 0);
        const gross = cost + ordersTotal + serviceFee;
        const total = Math.max(0, gross - discount);
        const sale: Omit<Sale, 'id'> = {
          type: 'session', deviceId: s.deviceId, deviceName: s.deviceName,
          sessionType: s.type, rateType: s.rateType, minutes,
          timeCost, gamesCount: s.gamesCount ?? 0, gamesCost, orders: s.orders, itemsTotal: ordersTotal,
          subtotal: cost + ordersTotal,
          discount, serviceFee, total, staff: s.staff, shiftId: s.shiftId, at: now, startedAt: s.startedAt,
        };
        await writeSale(sale);
        await updateDoc(doc(db, 'sessions', s.id), { status: 'settled', discount, serviceFee, total, endedAt: now });
        if (print) printReceipt({ ...sale, id: 'tmp' }, config);
      },

      async cancelSession(s) {
        // الإلغاء بدون تحصيل: وضع «ملغي» صريح، بلا فاتورة محفوظة — لا يُسجَّل أي مبلغ لهذه
        // الجلسة إطلاقاً، فلا يظهر وقتها ولا طلباتها في أي تقرير مالي (وقت اللعب والمأكولات
        // والمشروبات معاً = صفر إيراد).
        await updateDoc(doc(db, 'sessions', s.id), { status: 'cancelled', total: 0, endedAt: Date.now() });
        alertSessionCancelled(s.deviceId, s.id);
      },

      async markCollected(s) {
        await updateDoc(doc(db, 'sessions', s.id), { collected: true });
        alertPaymentCollected(s.deviceId, s.id);
      },

      async extendSession(s, extraMinutes) {
        if (s.type !== 'limited') throw new Error('التمديد متاح فقط للجلسات مجدودة الوقت');
        // في نظام "جيم واحد" كل تمديد يُحتسب جيماً إضافياً
        const patch: Record<string, number> = { limitedMinutes: s.limitedMinutes + extraMinutes };
        if (s.rateType === 'game') patch.gamesCount = (s.gamesCount ?? 0) + 1;
        await updateDoc(doc(db, 'sessions', s.id), patch);
        alertExtended(s.deviceId);
      },

      async pauseSession(s) {
        if (s.paused) return;
        await updateDoc(doc(db, 'sessions', s.id), { paused: true, pausedAt: Date.now() });
        alertSessionPaused(s.deviceId, s.id);
      },

      async resumeSession(s) {
        if (!s.paused) return;
        const now = Date.now();
        const addedPause = s.pausedAt ? now - s.pausedAt : 0;
        await updateDoc(doc(db, 'sessions', s.id), {
          paused: false, pausedAt: null, pausedMs: (s.pausedMs ?? 0) + addedPause,
        });
        alertSessionResumed(s.deviceId, s.id);
      },

      async addOrders(s, items, foodDiscount = 0, drinksDiscount = 0, print = false) {
        if (!Array.isArray(items) || items.length === 0) throw new Error('أضف منتجاً واحداً على الأقل');
        const lines: OrderItem[] = [];
        for (const it of items) {
          const qty = Math.floor(Number(it.qty) || 0);
          if (qty <= 0) continue;
          const inv = inventory.find((i) => i.id === it.itemId);
          if (!inv) throw new Error('المنتج غير موجود');
          if (inv.stock < qty) throw new Error(`الكمية غير كافية من ${inv.name} (المتبقي ${inv.stock})`);
          lines.push({ itemId: inv.id, name: inv.name, price: inv.price, qty, category: inv.category });
        }
        if (lines.length === 0) throw new Error('أضف منتجاً واحداً على الأقل');

        // دمج جميع أصناف السلة دفعة واحدة مع تراكم الكميات للأصناف المكررة — بدلاً من
        // استدعاءات متتالية تعتمد كلها على نسخة قديمة من الجلسة فتضيع معظم الأصناف.
        const orders = [...s.orders];
        for (const l of lines) {
          const idx = orders.findIndex((o) => o.itemId === l.itemId);
          if (idx >= 0) orders[idx] = { ...orders[idx], qty: orders[idx].qty + l.qty };
          else orders.push({ ...l });
        }

        // خصم المأكولات وخصم المشروبات يُطبَّقان معاً على سطور الطلب الجديد ويُحفظ صافي كل سطر.
        const patched = applyOrderDiscount(orders, lines, foodDiscount, drinksDiscount);

        // كتابة ذرّية: تحديث الجلسة + إنقاص المخزون لكل الأصناف في دفعة واحدة.
        const batch = writeBatch(db);
        batch.update(doc(db, 'sessions', s.id), { orders: patched });
        for (const l of lines) batch.update(doc(db, 'inventory', l.itemId), { stock: increment(-l.qty) });
        await batch.commit();
        alertCash();
        // طباعة إيصال الطلب فوراً بعد نجاح الحفظ عندما يكون خيار «طباعة الفاتورة» مفعلاً.
        if (print) {
          const discOf = (cat: ItemCategory) =>
            lines
              .filter((l) => l.category === cat)
              .reduce((sum, l) => sum + (patched.find((o) => o.itemId === l.itemId)?.discount ?? 0), 0);
          const foodDisc = Math.round(discOf('food') * 100) / 100;
          const drinksDisc = Math.round(discOf('drinks') * 100) / 100;
          const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
          printOrderTicket(
            {
              deviceName: s.deviceName,
              staff: user?.displayName ?? 'غير معروف',
              at: Date.now(),
              items: lines,
              subtotal,
              discountByCategory: { food: foodDisc, drinks: drinksDisc },
              total: Math.max(0, subtotal - foodDisc - drinksDisc),
            },
            config,
          );
        }
      },

      async directStoreSale(items, print, foodDiscount = 0, drinksDiscount = 0) {
        const shift = requireShift();
        const orders: OrderItem[] = [];
        for (const it of items) {
          const inv = inventory.find((i) => i.id === it.itemId);
          if (!inv) throw new Error('المنتج غير موجود');
          if (inv.stock < it.qty) throw new Error(`الكمية غير كافية من ${inv.name} (المتبقي ${inv.stock})`);
          orders.push({ itemId: inv.id, name: inv.name, price: inv.price, qty: it.qty, category: inv.category });
        }
        const itemsTotal = orders.reduce((sum, o) => sum + o.price * o.qty, 0);
        const foodGross = orders.filter((o) => o.category === 'food').reduce((s, o) => s + o.price * o.qty, 0);
        const drinksGross = orders.filter((o) => o.category === 'drinks').reduce((s, o) => s + o.price * o.qty, 0);
        // خصم المأكولات وخصم المشروبات مستقلان ويُطبَّقان معاً على نفس الفاتورة — كلٌّ يحصر في مجموع فئته.
        const cap = (v: number, limit: number) => Math.min(Math.max(0, Math.round((Number(v) || 0) * 100) / 100), limit);
        const foodDisc = cap(foodDiscount, foodGross);
        const drinksDisc = cap(drinksDiscount, drinksGross);
        const discountAmt = Math.round((foodDisc + drinksDisc) * 100) / 100;
        const discountByCategory: Partial<Record<ItemCategory, number>> = { food: foodDisc, drinks: drinksDisc };
        const now = Date.now();
        const sale: Omit<Sale, 'id'> = {
          type: 'store', deviceId: null, deviceName: null, sessionType: null, rateType: null,
          minutes: 0, timeCost: 0, gamesCount: 0, gamesCost: 0, orders, itemsTotal,
          subtotal: itemsTotal, discount: discountAmt, discountByCategory, serviceFee: 0,
          total: itemsTotal - discountAmt,
          staff: user?.displayName ?? 'غير معروف', shiftId: shift.id, at: now,
        };
        // كتابة ذرّية: الفاتورة + إنقاص المخزون في دفعة واحدة حتى لا يتبقى سجل بدون إنقاص.
        const saleRef = doc(collection(db, 'sales'));
        const batch = writeBatch(db);
        batch.set(saleRef, sale);
        for (const o of orders) {
          batch.update(doc(db, 'inventory', o.itemId), { stock: increment(-o.qty) });
        }
        await batch.commit();
        const saleId = saleRef.id;
        alertCash();
        if (print) printReceipt({ ...sale, id: saleId }, config);
      },

      async addIncome(stream, amount, note, print, source) {
        const shift = requireShift();
        const amt = Math.round((Number(amount) || 0) * 100) / 100;
        if (amt <= 0) throw new Error('أدخل مبلغاً صحيحاً أكبر من صفر');
        const now = Date.now();
        const sale: Omit<Sale, 'id'> = {
          type: stream, deviceId: null, deviceName: null, sessionType: null, rateType: null,
          minutes: 0, timeCost: 0, gamesCount: 0, gamesCost: 0, orders: [], itemsTotal: 0,
          subtotal: amt, discount: 0, serviceFee: 0, total: amt,
          staff: user?.displayName ?? 'غير معروف', shiftId: shift.id, at: now,
          note: note.trim() || undefined, source,
        };
        const id = await writeSale(sale);
        alertCash();
        if (print) printReceipt({ ...sale, id }, config);
      },

      async addDevice(name) {
        const number = devices.reduce((mx, d) => Math.max(mx, d.number), 0) + 1;
        await addDoc(collection(db, 'devices'), { number, name: name || `بلايستيشن 4 #${number}` });
      },

      async removeDevice(deviceId) {
        if (sessions.some((s) => s.deviceId === deviceId)) throw new Error('أوقف الجلسة النشطة على هذا الجهاز أولاً');
        await deleteDoc(doc(db, 'devices', deviceId));
      },

      async addInventoryItem(name, price, cost, stock, category) {
        await addDoc(collection(db, 'inventory'), { name, price, cost, stock, category });
      },

      async updateInventoryItem(id, patch) {
        await updateDoc(doc(db, 'inventory', id), patch);
      },

      async deleteInventoryItem(id) {
        await deleteDoc(doc(db, 'inventory', id));
      },

      async updateConfig(patch) {
        // دمج في الخادم (merge) — لا يستبدل المستند بالكامل، فيُحفظ التغيير دائماً ولا تـفقد الحقول الأخرى.
        // تنظيف عميق أولاً: أي قيمة undefined (حقول مباراة فارغة) ترفضها Firestore وتمنع الحفظ.
        await setDoc(doc(db, 'config', 'main'), stripUndefined(patch), { merge: true });
      },

      async startShift(openingFloat) {
        if (myOpenShift) throw new Error('توجد وردية مفتوحة بالفعل');
        // منع التزامن: لا يمكن للمدير والموظف فتح ورديتين في نفس الوقت
        if (openShifts.length > 0) throw new Error('يتعذر فتح وردية الآن — توجد وردية نشطة أخرى. انتظر حتى يتم تقفيلها.');
        if (openingFloat == null || !Number.isFinite(Number(openingFloat))) {
          throw new Error('يرجى إدخال قيمة النقدية الافتتاحية لبدء الوردية');
        }
        const amt = Math.max(0, Math.round((Number(openingFloat) || 0) * 100) / 100);
        const data: Omit<Shift, 'id'> = {
          staff: user?.displayName ?? 'غير معروف', role: user?.role ?? 'staff',
          startedAt: Date.now(), endedAt: null,
          openingFloat: amt,
          sessionCash: 0, storeCash: 0, fawryCash: 0, printerCash: 0, matchViewingCash: 0, miscCash: 0, withdrawals: 0, total: 0, status: 'open',
        };
        await addDoc(collection(db, 'shifts'), data);
        alertCash();
        alertShiftOpen(user?.displayName ?? 'غير معروف');
      },

      async closeShift() {
        const shift = requireShift();
        const activeSessions = sessions.filter((s) => s.status === 'active');
        if (activeSessions.length > 0) {
          throw new Error('يتعذر إغلاق الوردية حالياً: يوجد جلسات نشطة قيد التشغيل. يجب إنهاء أو تحصيل جميع الجلسات المفتوحة أولاً.');
        }
        const { sessionCash, storeCash, fawryCash, printerCash, matchViewingCash, miscCash, miscBySource, withdrawals, deposits, sessionTimeCash, foodCash, drinksCash } = await shiftTotals(shift.id);
        // تعداد الجلسات الملقاة دون تحصيل (status = cancelled) داخل الوردية — يُحفظ للتقرير الكامل.
        const cancelledSnap = await getDocs(query(collection(db, 'sessions'), where('shiftId', '==', shift.id), where('status', '==', 'cancelled')));
        const cancelledCount = cancelledSnap.size;
        // الإجمالي المحفوظ يمثل صافي إيراد الوردية فقط — النقدية الافتتاحية تُضاف ديناميكياً عند العرض ولا تُحتسب هنا.
        // صافي الخصم = إجمالي السحوبات − إجمالي الإضافات المفعّلة (سحب 100 وإضافة 50 = خصم صافٍ 50 فقط).
        const netRevenue = sessionCash + storeCash + fawryCash + printerCash + matchViewingCash + miscCash - withdrawals + deposits;
        await updateDoc(doc(db, 'shifts', shift.id), {
          status: 'closed', endedAt: Date.now(), sessionCash, storeCash, fawryCash, printerCash, matchViewingCash, miscCash, miscBySource, withdrawals, deposits,
          sessionTimeCash, foodCash, drinksCash, cancelledCount,
          // صافي إيراد الوردية شامل حركة الخزنة (حتى لو تجاوزت السحوبات الإيراد)، يُحافظ على القيمة
          // السالبة كما هي — فالتقفيل يعكس صافي الخزنة الحقيقي دون قصّ عند الصفر.
          total: netRevenue,
        });
        alertCash();
        alertShiftClose(user?.displayName ?? 'غير معروف');
      },

      async moveCash(type, amount, note) {
        const shift = requireShift();
        const amt = Math.round((Number(amount) || 0) * 100) / 100;
        if (amt <= 0) throw new Error('أدخل مبلغاً صحيحاً أكبر من صفر');
        if (!note || !note.trim()) throw new Error('يرجى كتابة ملاحظة توضح سبب العملية (للشفافية في سجل الخزنة)');
        const now = Date.now();
        const isDeposit = type === 'deposit';
        // الإضافة النقدية تُفعل بعد دقيقتين (قيد التفعيل) — تُحسب في الإيراد بعد انتهاء المهلة فقط.
        await addDoc(collection(db, 'withdrawals'), {
          shiftId: shift.id,
          staff: user?.displayName ?? 'غير معروف',
          amount: amt,
          note: note.trim(),
          type,
          status: isDeposit ? 'pending' : 'active',
          activateAt: isDeposit ? now + 120000 : now,
          at: now,
        });
      },

      async deleteSale(id) {
        await deleteDoc(doc(db, 'sales', id));
      },

      /** حذف سجل وردية نهائياً، مع حذف كل السحوبات المرتبطة بها (بنفس shiftId).
       *  حذف ثنائي الاتجاه: يُحذف في دفعة ذرّية واحدة (writeBatch) كلٌّ من سجل الوردية نفسه
       *  (shifts/{id}) وتقريرها المؤرشف في «تقارير الورديات» (shiftReports/{id}) —
       *  التوافق عبر رقم الوردية المشترك (معرّف التقرير = shiftId) فلا تبقى أي بيانات يتيمة.
       *  تتزامن الحالة المحلية تلقائياً عبر اشتراكات onSnapshot على المجموعات. */
      async deleteShift(id) {
        await purgeQuery(query(collection(db, 'withdrawals'), where('shiftId', '==', id), limit(450)));
        const batch = writeBatch(db);
        batch.delete(doc(db, 'shifts', id));
        batch.delete(doc(db, 'shiftReports', id));
        await batch.commit();
      },

      async deleteWithdrawal(id) {
        await deleteDoc(doc(db, 'withdrawals', id));
      },

      /** أرشفة دائمة لكامل سجل الوردية (تقريرها) — upsert برقم الوردية — يُستدعى عند رفض
       *  إشعار «نهاية/تقرير الوردية» من جرس إشعارات الورديات، فيظهر فوراً في «تقارير الورديات». */
      async saveShiftReport(shift) {
        const { id: _id, ...fullShift } = shift;
        await setDoc(doc(db, 'shiftReports', shift.id), { shiftId: shift.id, ...fullShift, createdAt: Date.now() });
      },

      /** حذف دائم لتقرير الوردية — حذف ثنائي الاتجاه: يُحذف في دفعة ذرّية واحدة (writeBatch) كلٌّ من
       *  تقرير الوردية (shiftReports/{id}) وسجل الوردية المقابل من «سجل الورديات» (shifts/{id})
       *  بالتوافق عبر رقم الوردية المشترك؛ فلا يبقى سجل يتيم في أي من القسمين لحظةً واحدة. */
      async deleteShiftReport(id) {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'shiftReports', id));
        batch.delete(doc(db, 'shifts', id));
        await batch.commit();
      },

      /** إنشاء دورة بلايستيشن جديدة (حالة pending بلا قرعة) — يعيد رقم الدورة للمعاينة الفورية. */
      async createTournament(name, format, participants) {
        const nm = name.trim();
        if (!nm) throw new Error('أدخل اسم الدورة');
        const list = participants.map((p) => p.trim()).filter(Boolean);
        if (list.length < 2) throw new Error('أضف مشتركين اثنين على الأقل قبل إنشاء الدورة');
        const ref = await addDoc(collection(db, 'tournaments'), {
          name: nm,
          format,
          participants: list,
          stage: 'pending',
          bracket: [],
          groups: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return ref.id;
      },

      /** حفظ كامل تقدم الدورة (القرعة، النتائج، الشجرة، المجموعات) في Firestore — يُستأنف عبر الاشتراك اللحظي.
       *  تُمرَّر البيانات أولاً عبر الدالة المستقلة `cleanTournament` — تُحذف أي مفتاح قيمته `undefined`
       *  (مثل مقاعد BYE الفارغة) لأن Firestore تراه غير صالح وتعلّق التحديث. */
      async saveTournament(t) {
        await setDoc(doc(db, 'tournaments', t.id), { ...cleanTournament(t), updatedAt: Date.now() });
      },

      async deleteTournament(id) {
        await deleteDoc(doc(db, 'tournaments', id));
      },

      /** حذف دائم ونهائي لسجلات المبيعات/المعاملات الأقدم من عدد الأيام المحدّد — يقرأ مباشرة من Firestore
       * (وليس فقط من الذاكرة المحلية المحدودة بآخر 300 سجل) حتى يشمل الحذف كل السجلات القديمة فعلاً.
       * يُحذف معها أيضاً كل السحوبات الأقدم من نفس التاريخ حتى لا تبقى سجلات سحب قديمة معلّقة. */
      async deleteOldSales(olderThanDays) {
        const cutoff = Date.now() - Math.max(0, olderThanDays) * 86400000;
        const salesDeleted = await purgeQuery(query(collection(db, 'sales'), where('at', '<', cutoff), limit(450)));
        const withdrawalsDeleted = await purgeQuery(query(collection(db, 'withdrawals'), where('at', '<', cutoff), limit(450)));
        return salesDeleted + withdrawalsDeleted;
      },

      /** حذف دائم ونهائي لكل سجلات المبيعات/المعاملات بلا استثناء — لتنظيف بيانات التجربة قبل بدء العمل الفعلي.
       * يُحذف معها أيضاً كل السحوبات بلا استثناء حتى لا تبقى أي سجلات سحب قديمة. */
      async deleteAllSales() {
        const salesDeleted = await purgeQuery(query(collection(db, 'sales'), limit(450)));
        const withdrawalsDeleted = await purgeQuery(query(collection(db, 'withdrawals'), limit(450)));
        return salesDeleted + withdrawalsDeleted;
      },

      async addUser(displayName, username, pin, role) {
        const dn = displayName.trim();
        const uname = username.trim().toLowerCase();
        const p = pin.trim();
        if (!dn) throw new Error('الاسم مطلوب');
        if (!uname) throw new Error('اسم المستخدم مطلوب');
        if (!/^\d{4,6}$/.test(p)) throw new Error('رمز الدخول يجب أن يكون من 4 إلى 6 أرقام');
        if (users.some((u) => u.username.toLowerCase() === uname)) throw new Error('اسم المستخدم موجود بالفعل');
        await addDoc(collection(db, 'users'), { displayName: dn, username: uname, pin: p, role });
      },

      async updateUser(id, patch) {
        const target = users.find((u) => u.id === id);
        if (!target) throw new Error('المستخدم غير موجود');
        const nextPatch: Partial<Pick<AppUser, 'displayName' | 'username' | 'pin' | 'role' | 'avatarUrl'>> = { ...patch };
        if (typeof patch.displayName === 'string') {
          if (!patch.displayName.trim()) throw new Error('الاسم مطلوب');
          nextPatch.displayName = patch.displayName.trim();
        }
        if (typeof patch.username === 'string') {
          const uname = patch.username.trim().toLowerCase();
          if (!uname) throw new Error('اسم المستخدم مطلوب');
          if (users.some((u) => u.id !== id && u.username.toLowerCase() === uname)) throw new Error('اسم المستخدم موجود بالفعل');
          nextPatch.username = uname;
        }
        if (typeof patch.pin === 'string') {
          if (!/^\d{4,6}$/.test(patch.pin.trim())) throw new Error('رمز الدخول يجب أن يكون من 4 إلى 6 أرقام');
          nextPatch.pin = patch.pin.trim();
        }
        if (patch.role && patch.role !== 'admin' && target.role === 'admin') {
          const otherAdmins = users.filter((u) => u.role === 'admin' && u.id !== id);
          if (otherAdmins.length === 0) throw new Error('يجب أن يبقى حساب مدير واحد على الأقل');
        }
        await updateDoc(doc(db, 'users', id), nextPatch);
      },

      async deleteUser(id) {
        const target = users.find((u) => u.id === id);
        if (!target) return;
        if (user && target.username === user.username) throw new Error('لا يمكنك حذف حسابك الحالي وأنت مسجل الدخول به');
        if (target.role === 'admin') {
          const otherAdmins = users.filter((u) => u.role === 'admin' && u.id !== id);
          if (otherAdmins.length === 0) throw new Error('يجب أن يبقى حساب مدير واحد على الأقل');
        }
        await deleteDoc(doc(db, 'users', id));
      },

      async addCustomer(name, phone, facebookUrl, notes) {
        const nm = name.trim();
        if (!nm) throw new Error('يرجى إدخال اسم الزبون');
        await addDoc(collection(db, 'customers'), {
          name: nm,
          phone: phone.trim(),
          facebookUrl: facebookUrl.trim(),
          notes: notes.trim(),
          createdAt: Date.now(),
        });
      },

      async updateCustomer(id, patch) {
        const next: Partial<Pick<Customer, 'name' | 'phone' | 'facebookUrl' | 'notes'>> = { ...patch };
        if (typeof next.name === 'string') {
          if (!next.name.trim()) throw new Error('يرجى إدخال اسم الزبون');
          next.name = next.name.trim();
        }
        if (typeof next.phone === 'string') next.phone = next.phone.trim();
        if (typeof next.facebookUrl === 'string') next.facebookUrl = next.facebookUrl.trim();
        if (typeof next.notes === 'string') next.notes = next.notes.trim();
        await updateDoc(doc(db, 'customers', id), next);
      },

      async deleteCustomer(id) {
        await deleteDoc(doc(db, 'customers', id));
      },

      async uploadSiteImage(file) {
        const storageRef = ref(storage, `site/logo-${Date.now()}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        return url;
      },

      timeCostOf,
      subtotalOf,
    } as StoreApi;
  }, [ready, online, user, config, devices, sessions, inventory, openShifts, shifts, sales, withdrawals, users, customers, shiftReports, tournaments]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** Hook that re-renders every `ms` (default 1000) — used for live timers. */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * تنبيهات الجلسات المحدودة (ملفات صوتية من إعدادات لوحة الإدارة):
 * - تنبيه بصوت "اقتراب انتهاء الوقت" قبل نهاية المدة الأصلية بدقيقتين.
 * - تنبيه بصوت "انتهاء الوقت الأصلي" عند بلوغ نهاية المدة (يُشغَّل بأولوية قصوى).
 * - يتوقف صوت الجلسة فوراً عند تحصيلها (حتى لو حصّلها متصفح آخر).
 * - زر كتم البطاقة يستدعي silence(sessionId) لكتم إعادة إطلاق تنبيهات هذه الجلسة فقط
 *   حتى تُعاد تسليح الجلسة (التمديد يغيّر المفتاح فيُعاد الإنذار).
 * يُعاد التسليح تلقائياً بعد أي تمديد (المفتاح يشمل limitedMinutes).
 */
export function useExpiryAlerts(sessions: Session[]): { silence: (sessionId: string) => void } {
  const fired = useRef<Set<string>>(new Set());
  const alertedIds = useRef<Set<string>>(new Set());
  // مفاتيح كتمها المستخدم يدوياً — تُسكت نهائياً في هذا التبويب حتى تُعاد تسليح الجلسة بمفتاح جديد.
  const muted = useRef<Set<string>>(new Set());
  // مفاتيح كتم فورية فريدة لكل (جلسة + نوع): `warn:sessionId` و `expired:sessionId` — للجلسة الواحدة فقط.
  const mutedIds = useRef<Set<string>>(new Set());
  const silence = useCallback((activeSessionId: string) => {
    // كتم كلا تنبيهي (اقتراب انتهاء + انتهاء) لهذه الجلسة فقط (تمررها بطاقتها) — لا تُلمس جلسات أخرى.
    mutedIds.current.add(`expired:${activeSessionId}`);
    mutedIds.current.add(`warn:${activeSessionId}`);
    for (const key of fired.current) {
      if (key.startsWith(`${activeSessionId}:`)) muted.current.add(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mark = useCallback((id: string, key: string, deviceId: string, kind: 'expired' | 'almostUp') => {
    alertedIds.current.add(id);
    if (fired.current.has(key) || muted.current.has(key)) return;
    fired.current.add(key);
    if (kind === 'expired') alertTimeExpired(deviceId, id);
    else alertTimeAlmostUp(deviceId, id);
  }, []);
  const now = useTick(1000);

  // إذا أُغلقت الجلسة المُنبَّهة (حتى من متصفح آخر) أو كانت موقوفة مؤقتاً، فأوقف
  // تنبيهات هذه الجلسة فقط، واترك بقية التنبيهات تستأنف من طابور الصوت تلقائياً.
  // الجلسة الموقوفة مؤقتاً تُعامل كغائبة حتى لا يستمر إنذارها أثناء الإيقاف.
  const activeIds = new Set(
    sessions
      .filter((s) => s.type === 'limited' && s.limitedMinutes > 0 && s.status === 'active' && !s.paused)
      .map((s) => s.id),
  );
  for (const id of [...alertedIds.current]) {
    if (!activeIds.has(id)) {
      alertedIds.current.delete(id);
      stopUrgentAlarms(id);
    }
  }

  for (const s of sessions) {
    // حراسة أفقية/عمودية: لا يُعاد إطلاق تنبيه الجلسة المكتومة فقط — بلا أي جلسة أخرى.
    if (s.type !== 'limited' || s.limitedMinutes <= 0) continue;
    if (s.status !== 'active' || s.paused) continue;
    const totalMs = s.limitedMinutes * 60000;
    const remaining = totalMs - elapsedMs(s, now);
    // حماية إضافية: لو انحرف وقت الجهاز أو بقيت المدة خاطئة (أو صارت 0 بسبب إيقاف مؤقت
    // غير مكتمل الكتابة)، لا تُطلق إنذار انتهاء قبل أوانه.
    if (remaining <= 0) {
      if (!mutedIds.current.has(`expired:${s.id}`)) {
        mark(s.id, `${s.id}:${s.limitedMinutes}:expired`, s.deviceId, 'expired');
      }
    } else if (remaining <= 2 * 60000 && !mutedIds.current.has(`warn:${s.id}`)) {
      mark(s.id, `${s.id}:${s.limitedMinutes}:warn`, s.deviceId, 'almostUp');
    }
  }

  return { silence };
}

/** يعيد true طالما هناك تنبيه صوتي متكرر قيد التشغيل الآن — لعرض زر "كتم التنبيه" بشكل بارز. */
export function useAlarmActive(): boolean {
  const [active, setActive] = useState(isAlarmActive());
  useEffect(() => subscribeAlarmActive(setActive), []);
  return active;
}
