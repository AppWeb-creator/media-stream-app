import React, { useEffect, useMemo, useState } from 'react';
import { useStore, useTick, canViewRecord, elapsedMs } from '../store/cafe';
import { DeviceCard } from './DeviceCard';
import { StartSessionModal } from './modals/StartSessionModal';
import { OrderModal } from './modals/OrderModal';
import { SettleModal } from './modals/SettleModal';
import { StoreSaleModal } from './modals/StoreSaleModal';
import { IncomeModal } from './modals/IncomeModal';
import { CashMoveModal } from './modals/CashMoveModal';
import { MatchBell } from './MatchBell';
import { ShiftBell } from './ShiftBell';
import { ConfirmDialog } from './ConfirmDialog';
import { AdminPanel } from './AdminPanel';
import { ShiftOpenOverlay } from './ShiftOpenOverlay';
import { LiveClock } from './LiveClock';
import { TournamentWidget } from './TournamentWidget';
import { money, signedMoney, fmtDateTimeFull, fmtDuration, fmtClock } from '../lib/format';
import { speakAr, armAudioUnlock, getMatchAudioMaster } from '../lib/audio';
import { useMatches } from '../lib/useMatches';
import { dueMatchAlert, recordMatchAnnounced } from '../lib/matches';
import { silenceSession, alertError } from '../lib/audio';
import type { Session, QuickIncomeButton } from '../lib/types';
import { DEFAULT_QUICK_INCOME } from '../lib/types';
import { useExpiryAlerts } from '../store/cafe';
import logoUrl from '../assets/logo.png';

export function Dashboard() {
  const store = useStore();
  const { devices, sessions, config, user, online, myOpenShift, sales, withdrawals, users } = store;
  const now = useTick(1000);
  const { silence: silenceExpiry } = useExpiryAlerts(sessions);
  const matches = useMatches(config);

  // تذكيرات المباريات الصوتية: بمجرد تحميل المباريات أو تحديثها تُجمَّع النصوص الجاهزة من
  // dueMatchAlert (مباريات اليوم وغداً وبعد غد — بلا نافذة أيام) وتُمرَّر مباشرة إلى speakAr()
  // فتُعزف عبر طابور الأصوات المركزي نفسه الذي تعمل عليه تنبيهات الجلسات — كل مباراة تُذكر
  // مرة واحدة في اليوم (dedup عبر verdent_announced_matches_v1) فلا تتكرر ولا تبقى صامتة.
  // يُفتَح تصريح الصوت من أول تفاعل مستخدم (armAudioUnlock) لأن هذه التذكيرات تستحق من مؤقت
  // زمني وليس من نقرة مباشرة — وإلا يبقى النطق صامتاً في Edge/Chrome رغم عمل بقية التنبيهات.
  useEffect(() => {
    armAudioUnlock();
  }, []);

  useEffect(() => {
    const ms = config.matches;
    if (!ms?.audioEnabled) return;
    const repeatMs = (Math.max(1, ms.alertIntervalMin || 30) * 60000) || 180000;
    const check = () => {
      if (matches.length === 0) return;
      // المفتاح الرئيسي لصوت المباريات (localStorage): عند إغلاقه يُكتم كل شيء فوراً ولا نُسجل
      // أي تذكير كمنطوق حتى يتاح التذكير فور فتحه مجدداً.
      if (!getMatchAudioMaster()) return;
      const now = Date.now();
      const reminders = dueMatchAlert(matches, now, repeatMs);
      if (reminders.length === 0) return;
      const played: string[] = [];
      reminders.forEach((r) => {
        console.log('[match-alert] تذكير مباراة:', r.text);
        if (speakAr(r.text, r.id)) played.push(r.id);
      });
      // نُسجل آخر لحظة نطق لكل مباراة — تُحدث التذكير مرة أخرى بعد مضي فاصل التكرار (repeatMs).
      played.forEach((id) => recordMatchAnnounced(id, now));
    };
    check();
    const t = window.setInterval(check, 60000);
    return () => window.clearInterval(t);
  }, [config.matches, matches]);

  // كتم بطاقة الجلسة الواحدة: يمنع إعادة إطلاق إنذار انتهائها من هذا التبويب، ثم يُسقط
  // مقاطعها المعلّقة ويرفض حلقاتها من الطابور الصوتي (ويقطع صوتها الحالي إن كان يُشغَّل)،
  // فيُتابع pump بعدها التنبيه التالي بالترتيب — دون أي إفراغ/كتم عام لأي جلسة أخرى.
  const muteSession = (sessionId: string) => {
    silenceExpiry(sessionId);
    silenceSession(sessionId);
  };

  const [startFor, setStartFor] = useState<string | null>(null);
  const [orderFor, setOrderFor] = useState<Session | null>(null);
  const [settleFor, setSettleFor] = useState<Session | null>(null);
  const [storeSale, setStoreSale] = useState(false);
  const [income, setIncome] = useState<QuickIncomeButton | null>(null);
  const [admin, setAdmin] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeErr, setCloseErr] = useState('');
  const [openShiftFloat, setOpenShiftFloat] = useState(false);
  const [openingFloatInput, setOpeningFloatInput] = useState('');
  const [overlay, setOverlay] = useState<{ kind: 'open' | 'close'; userName: string; avatarUrl?: string } | null>(null);
  const [err, setErr] = useState('');

  // صورة المستخدم النشط فورياً من قائمة المستخدمين المزامنة، مع الرجوع إلى avatarUrl وقت تسجيل الدخول إن لزم.
  const activeUserAvatar = users.find(
    (u) => u.username === user?.username || u.displayName === user?.displayName,
  )?.avatarUrl || user?.avatarUrl;

  // تراكب سينمائي: يُغلق تلقائياً وبشكل مضمون بعد 3.5 ثوانٍ دائماً وبغض النظر عن أي شيء آخر.
  useEffect(() => {
    if (!overlay) return;
    const t = window.setTimeout(() => setOverlay(null), 3500);
    return () => window.clearTimeout(t);
  }, [overlay]);

  const sessionFor = (deviceId: string): Session | null =>
    sessions.find((s) => s.deviceId === deviceId) ?? null;

  // عمليات وردية المستخدم الحالية فقط (المدير يرى الكل في لوحة التقارير)
  const shiftSales = useMemo(
    () => (myOpenShift
      ? sales.filter((s) => s.shiftId === myOpenShift.id && canViewRecord(user, s.staff))
      : []),
    [sales, myOpenShift, user],
  );
  const sessionCash = shiftSales.filter((s) => s.type === 'session').reduce((a, s) => a + s.total, 0);
  const storeCash = shiftSales.filter((s) => s.type === 'store').reduce((a, s) => a + s.total, 0);
  const fawryCash = shiftSales.filter((s) => s.type === 'fawry').reduce((a, s) => a + s.total, 0);
  const printerCash = shiftSales.filter((s) => s.type === 'printer').reduce((a, s) => a + s.total, 0);
  const matchViewingCash = shiftSales.filter((s) => s.type === 'matchViewing').reduce((a, s) => a + s.total, 0);
  const miscCash = shiftSales.filter((s) => s.type === 'misc').reduce((a, s) => a + s.total, 0);
  // تفصيل الإيرادات الأخرى حسب اسم الزر (button title) — يعرض اسم الزر الفعلي بدلاً من "أخرى" العامة.
  const miscBySource = useMemo(
    () => {
      const map: Record<string, number> = {};
      for (const s of shiftSales) {
        if (s.type !== 'misc') continue;
        const k = (s.source && s.source.trim()) || 'إيراد آخر';
        map[k] = (map[k] || 0) + s.total;
      }
      return Object.entries(map).filter(([, v]) => v > 0);
    },
    [shiftSales],
  );
  const grandCash = sessionCash + storeCash + fawryCash + printerCash + matchViewingCash + miscCash;
  // سحب/إضافة نقد الخزنة الحالي للوردية: السحوبات تُخصم فوراً، والإضافات مقيّدة بمهلة التأجيل
  // (لا تُحتسب إلا بعد انتهاء الدقيقتين، وإلا تُعرض «قيد التفعيل» ولا تدخل في أرقام الوردية).
  const shiftCashMoves = useMemo(
    () => withdrawals.filter((w) => myOpenShift && w.shiftId === myOpenShift.id),
    [withdrawals, myOpenShift],
  );
  const activeCashMoves = shiftCashMoves.filter((w) => !(w.activateAt && now < w.activateAt));
  const shiftWithdrawals = activeCashMoves
    .filter((w) => (w.type ?? 'withdraw') === 'withdraw')
    .reduce((a, w) => a + (w.amount || 0), 0);
  const shiftDeposits = activeCashMoves
    .filter((w) => w.type === 'deposit')
    .reduce((a, w) => a + (w.amount || 0), 0);
  const shiftPendingDeposits = shiftCashMoves
    .filter((w) => w.type === 'deposit' && w.activateAt && now < w.activateAt)
    .reduce((a, w) => a + (w.amount || 0), 0);

  // مهلة أمان قبل تقفيل الوردية بعد آخر إضافة نقدية: 5 دقائق (300,000 ms) — تُمنع التقفيل حتى
  // تُؤكد الإضافة في الإيراد الصافي بالتأكيد (الإضافات تُفعَّل بعد دقيقتين أصلاً، والهامش يضمنها).
  const DEPOSIT_COOLDOWN_MS = 300000;
  const lastDepositAt = useMemo(() => {
    if (!myOpenShift) return 0;
    let latest = 0;
    for (const w of withdrawals) {
      if (w.shiftId !== myOpenShift.id) continue;
      if ((w.type ?? 'withdraw') !== 'deposit') continue;
      if (w.at > latest) latest = w.at;
    }
    return latest;
  }, [withdrawals, myOpenShift]);
  const depositCooldownRemaining = lastDepositAt > 0 ? Math.max(0, DEPOSIT_COOLDOWN_MS - (now - lastDepositAt)) : 0;
  const depositCooldownMsg = () => {
    const remSec = Math.ceil(depositCooldownRemaining / 1000);
    const mm = Math.floor(remSec / 60);
    const ss = remSec % 60;
    return `لا يمكن إغلاق الوردية الآن! يجب الانتظار 5 دقائق على الأقل بعد آخر عملية إضافة نقدية لتأكيد اعتماد المبلغ في الإيراد الصافي. المتبقي: ${mm} دقيقة و ${ss} ثانية.`;
  };

  const openShiftNow = async () => {
    setErr('');
    const v = openingFloatInput.trim();
    const num = Number(v);
    if (v === '' || !Number.isFinite(num) || num < 0) {
      setErr('يرجى إدخال قيمة النقدية الافتتاحية لبدء الوردية');
      return;
    }
    try {
      await store.startShift(num);
      setOpenShiftFloat(false);
      setOpeningFloatInput('');
      setOverlay({ kind: 'open', userName: user?.displayName || 'الموظف', avatarUrl: activeUserAvatar });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    }
  };
  const closeShiftNow = async () => {
    setCloseErr('');
    if (depositCooldownRemaining > 0) {
      setCloseErr(depositCooldownMsg());
      alertError();
      return;
    }
    try {
      await store.closeShift();
      setConfirmClose(false);
      setOverlay({ kind: 'close', userName: user?.displayName || 'الموظف', avatarUrl: activeUserAvatar });
    } catch (e) {
      setCloseErr(e instanceof Error ? e.message : 'حدث خطأ');
      alertError();
    }
  };

  const expiredSessions = sessions.filter(
    (s) => s.type === 'limited' && s.limitedMinutes > 0 && s.status === 'active' && !s.paused &&
      elapsedMs(s, now) >= s.limitedMinutes * 60000,
  );
  const expiredCount = expiredSessions.length;
  const incomeButtons: QuickIncomeButton[] = config.quickIncomeButtons && config.quickIncomeButtons.length ? config.quickIncomeButtons : DEFAULT_QUICK_INCOME;

  // حالة توفر الأجهزة: عدد المتاح/المشغول ودرجة لون النقطة المتحركة داخل شارة التوفر.
  const availCount = devices.filter((d) => !sessionFor(d.id)).length;
  const busyCount = devices.length - availCount;
  const availDot = !myOpenShift
    ? 'closed'
    : busyCount === 0
      ? 'all-free'
      : availCount === 0
        ? 'all-busy'
        : availCount > busyCount
          ? 'more-free'
          : 'more-busy';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row topbar-head">
          <div className="brand-center">
            <div className="brand-frame">
              <h1 className="brand-title">{config.siteName || 'بلايستيشن أحمد الشريف'}</h1>
              <span className={`avail-badge avail-${availDot}`}>
                <i className={`avail-dot avail-dot-${availDot}`} />
                {availCount} متاح من {devices.length} أجهزة
              </span>
            </div>
          </div>
          <span
            className={`conn live-${!myOpenShift ? 'off' : online ? 'ok' : 'bad'}`}
            title={myOpenShift
              ? `مزامنة Firestore — ${online ? 'متصل' : 'غير متصل'}`
              : 'لا توجد وردية مفتوحة'}
          >
            <i className="conn-dot" />
            {!myOpenShift ? 'غير نشط' : online ? 'مباشر' : 'غير متصل'}
          </span>
        </div>

        <div className="shift-row">
          <span className="brand-badge brand-badge-xl">
            <img src={config.logoUrl || logoUrl} alt="الشعار" />
          </span>

          <div className={`shift-chip ${myOpenShift ? 'open' : 'closed'}`}>
          {myOpenShift ? (
            <>
              <div className="shift-title">
                <span className="shift-dot" />
                <div>
                  <span className="shift-status">الوردية مفتوحة</span>
                  <strong className="shift-staff">{myOpenShift.staff}</strong>
                  <span className="shift-opened">فُتحت {fmtClock(myOpenShift.startedAt)}</span>
                </div>
              </div>
              <div className="shift-cash">
                {sessionCash > 0 && <span className="sc-item">الجلسات <b>{money(sessionCash, config.currency)}</b></span>}
                {storeCash > 0 && <span className="sc-item">المبيعات <b>{money(storeCash, config.currency)}</b></span>}
                {fawryCash > 0 && <span className="sc-item">فوري <b>{money(fawryCash, config.currency)}</b></span>}
                {printerCash > 0 && <span className="sc-item">الطابعة <b>{money(printerCash, config.currency)}</b></span>}
                {matchViewingCash > 0 && <span className="sc-item">مشاهدة المباريات <b>{money(matchViewingCash, config.currency)}</b></span>}
                {miscBySource.map(([name, v]) => (
                  <span className="sc-item" key={name}>{name} <b>{money(v, config.currency)}</b></span>
                ))}
                <span className="sc-item total">الإجمالي <b>{money(grandCash, config.currency)}</b></span>
              </div>
            </>
          ) : (
            <>
              <div>
                <strong>لا توجد وردية مفتوحة</strong>
                <span>افتح وردية لبدء العمل</span>
              </div>
              <button className="btn primary" onClick={() => setOpenShiftFloat(true)}>فتح وردية</button>
            </>
          )}
          </div>
        </div>

        <div className="topbar-actions">
          <button className="btn" onClick={() => setStoreSale(true)}>🛒 بيع مباشر</button>
          {incomeButtons.map((b) => (
            <button key={b.id} className={`btn qib qib-${b.tone}`} onClick={() => setIncome(b)}>{b.icon} {b.label}</button>
          ))}
          {myOpenShift && <button className="btn danger" onClick={() => setConfirmClose(true)}>تقفيل الوردية</button>}
          <button className="btn" onClick={() => setWithdraw(true)}>💸 سحب وإضافة</button>
          {user?.role === 'admin' && <button className="btn" onClick={() => setAdmin(true)}>⚙ الإدارة</button>}
          <MatchBell matches={matches} />
          {user?.role === 'admin' && <ShiftBell />}
          <button className="btn ghost" onClick={() => setConfirmLogout(true)}>خروج</button>
        </div>
      </header>

      {err && <div className="banner-error">{err} <button className="x" onClick={() => setErr('')}>×</button></div>}
      {user?.role === 'admin' && config.maintenanceMode && (
        <div className="banner-warn">🛠 وضع الصيانة مفعّل الآن — الموظفون لا يمكنهم الدخول أو تنفيذ أي عمليات حالياً. يمكنك إيقافه من لوحة الإدارة.</div>
      )}
      {!myOpenShift && (
        <div className="banner-warn">افتح وردية أولاً قبل بدء الجلسات أو البيع.</div>
      )}
      {expiredCount > 0 && (
        <div className="banner-warn pulse expired-banner">
          <span>⏰ انتهى وقت {expiredCount} جلسة محدودة — قم بحساب الفاتورة.</span>
        </div>
      )}

      <main className="device-grid">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            session={sessionFor(d.id)}
            onStart={setStartFor}
            onEnd={setSettleFor}
            onOrder={setOrderFor}
            onMute={muteSession}
          />
        ))}
        {devices.length === 0 && (
          <div className="device-card idle" style={{ gridColumn: '1 / -1' }}>
            <div className="device-body">
              <p className="device-hint">لا توجد أجهزة بعد. من الإدارة ← الأجهزة والأسعار ← إضافة جهاز.</p>
            </div>
          </div>
        )}
      </main>

      <TournamentWidget />

      <LiveClock />

      {startFor && <StartSessionModal deviceId={startFor} onClose={() => setStartFor(null)} />}
      {orderFor && <OrderModal session={orderFor} onClose={() => setOrderFor(null)} />}
      {settleFor && <SettleModal session={settleFor} onClose={() => setSettleFor(null)} />}
      {storeSale && <StoreSaleModal onClose={() => setStoreSale(false)} />}
      {income && <IncomeModal button={income} onClose={() => setIncome(null)} />}
      {admin && user?.role === 'admin' && <AdminPanel onClose={() => setAdmin(false)} />}
      {withdraw && <CashMoveModal onClose={() => setWithdraw(false)} />}

      {confirmLogout && (
        <ConfirmDialog
          title="تسجيل الخروج"
          message="هل أنت متأكد من تسجيل الخروج؟"
          confirmLabel="تأكيد الخروج"
          danger
          onConfirm={() => { setConfirmLogout(false); store.logout(); }}
          onClose={() => setConfirmLogout(false)}
        />
      )}

      {overlay && (
        <ShiftOpenOverlay
          kind={overlay.kind}
          userName={overlay.userName}
          avatarUrl={overlay.avatarUrl}
          fallbackLogo={config.logoUrl || logoUrl}
        />
      )}

      {openShiftFloat && (
        <div className="overlay" onClick={() => setOpenShiftFloat(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>فتح وردية جديدة</h3>
              <button className="x" onClick={() => setOpenShiftFloat(false)}>×</button>
            </div>
            <p className="device-hint">
              أدخل مبلغ درج النقدية الافتتاحي (المبلغ الموجود في الدرج عند بداية الوردية). سيتم إضافة هذا المبلغ إلى إجمالي الإيرادات عند التقفيل.
            </p>
            <label className="field-label">النقدية الافتتاحية ({config.currency}) <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="number"
              min={0}
              required
              value={openingFloatInput}
              onChange={(e) => setOpeningFloatInput(e.target.value)}
              placeholder="أدخل قيمة النقدية الافتتاحية"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void openShiftNow(); }}
            />
            {err && <p className="modal-error">{err}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setOpenShiftFloat(false)}>إلغاء</button>
              <button className="btn primary" onClick={() => void openShiftNow()}>فتح الوردية</button>
            </div>
          </div>
        </div>
      )}

      {confirmClose && myOpenShift && (
        <div className="overlay" onClick={() => { setConfirmClose(false); setCloseErr(''); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>تقرير تقفيل الوردية</h3>
              <button className="x" onClick={() => { setConfirmClose(false); setCloseErr(''); }}>×</button>
            </div>
            <div className="bill-box">
              <div className="orders-line">
                <span>الموظف المسؤول</span>
                <span>{myOpenShift.staff}</span>
              </div>
              <div className="orders-line"><span>وقت الفتح</span><span>{fmtDateTimeFull(myOpenShift.startedAt)}</span></div>
              <div className="orders-line"><span>وقت الإغلاق</span><span>{fmtDateTimeFull(now)}</span></div>
              <div className="orders-line"><span>المدة</span><span>{fmtDuration(now - myOpenShift.startedAt)}</span></div>
              <div className="orders-line"><span>النقدية الافتتاحية</span><span>{money(myOpenShift.openingFloat ?? 0, config.currency)}</span></div>
              <div className="orders-line"><span>نقدية جلسات الأجهزة</span><span>{money(sessionCash, config.currency)}</span></div>
              <div className="orders-line"><span>مبيعات الكاشير</span><span>{money(storeCash, config.currency)}</span></div>
              <div className="orders-line"><span>إيراد ماكنة فوري</span><span>{money(fawryCash, config.currency)}</span></div>
              <div className="orders-line"><span>إيراد الطابعة</span><span>{money(printerCash, config.currency)}</span></div>
              <div className="orders-line"><span>إيراد مشاهدة المباريات</span><span>{money(matchViewingCash, config.currency)}</span></div>
              {miscBySource.map(([name, v]) => (
                <div className="orders-line" key={name}><span>{name}</span><span>{money(v, config.currency)}</span></div>
              ))}
              {miscBySource.length > 1 && (
                <div className="orders-line"><span>إجمالي الإيرادات الأخرى</span><span>{money(miscCash, config.currency)}</span></div>
              )}
              <div className="orders-line"><span>سحوبات خلال الوردية</span><span className="danger-text">− {money(shiftWithdrawals, config.currency)}</span></div>
              {shiftDeposits > 0 && <div className="orders-line"><span>إضافات نقدية (مفعّلة)</span><span className="accent-text">+ {money(shiftDeposits, config.currency)}</span></div>}
              {shiftPendingDeposits > 0 && <div className="orders-line" style={{ opacity: 0.7 }}><span>إضافات قيد التفعيل (خلال دقيقتين)</span><span>{money(shiftPendingDeposits, config.currency)}</span></div>}
              <div className="orders-line"><span>صافي حركة الخزنة (إضافة − سحب)</span><span>{signedMoney(shiftDeposits - shiftWithdrawals, config.currency)}</span></div>
              <div className="orders-line"><span>عدد العمليات</span><span>{shiftSales.length}</span></div>
              <div className="orders-line total"><span>النقدية المستلمة للتسليم</span><span>{money((myOpenShift.openingFloat || 0) + grandCash - shiftWithdrawals + shiftDeposits, config.currency)}</span></div>
            </div>
            {shiftSales.length === 0 && (
              <p className="device-hint">لا توجد عمليات مسجلة في هذه الوردية.</p>
            )}
            <p className="device-hint">سلّم هذا المبلغ للموظف التالي أو للمدير مع درج النقدية.</p>
            {closeErr && (
              <div className="modal-error-box">⚠ {closeErr}</div>
            )}
            {depositCooldownRemaining > 0 && (
              <div className="modal-error-box cooldown-warn">⏳ {depositCooldownMsg()}</div>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => { setConfirmClose(false); setCloseErr(''); }}>إبقاء الوردية مفتوحة</button>
              <button className="btn danger" disabled={depositCooldownRemaining > 0} onClick={() => void closeShiftNow()}>تأكيد التقفيل</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
