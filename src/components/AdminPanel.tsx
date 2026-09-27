import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useStore, useTick } from '../store/cafe';
import { money, signedMoney, fmtClock, fmtDateTimeFull, fmtMinutes, fmtDuration, dayKey } from '../lib/format';
import { ALL_DEVICES_ID, speakAr, unlockAudio, setMatchAudioMaster, MATCH_AUDIO_MASTER_KEY } from '../lib/audio';
import { ConfirmDialog } from './ConfirmDialog';
import { Trash2 } from 'lucide-react';
import { Toast } from './Toast';
import { CustomersTab } from './CustomersTab';
import { ShiftSummaryModal } from './ShiftSummaryModal';
import { buildKnockoutBracket, shuffle, buildGroups, buildPlayoffList, rankGroup, allGroupMatchesDone, knockoutStageOf, applyKnockoutResult, findQualificationTie, applyTiebreak } from '../lib/tournament';
import { drawRevealSlots } from '../lib/reveal';
import type { AlertSounds, Config, Device, IncomeTone, ItemCategory, MatchEntry, MatchSettings, QuickIncomeButton, Role, Session, Shift, ShiftReport, Tournament, TournamentFormat, TournamentGroup, TournamentMatch, TournamentStage, Withdrawal } from '../lib/types';
import { classifyItem, DEFAULT_CONFIG, DEFAULT_QUICK_INCOME, orderLineNet } from '../lib/types';
import { MATCH_ALERT_INTERVALS } from '../lib/matches';
import { fileToDataUrl } from '../lib/image';

type Tab = 'settings' | 'inventory' | 'reports' | 'peaks' | 'withdrawals' | 'users' | 'customers' | 'matches';

/** الحسابات الحية للوردية من سجلات المبيعات وحركات الخزنة — تطابق تماماً منطق shiftTotals عند التقفيل. */
type ShiftLive = {
  sessionCash: number;      // إجمالي إيراد الجلسات (يشمل طلبات الجلسات) — s.total
  sessionTime: number;      // إيراد وقت اللعب الصافي فقط — timeCost + gamesCost
  storeCash: number;        // مبيعات الكاشير (فواتير البيع المباشر)
  fawryCash: number;
  printerCash: number;
  matchViewingCash: number;
  miscCash: number;
  miscBySource: Record<string, number>;
  foodCash: number;         // صافي إيراد المأكولات من كل الفواتير
  drinksCash: number;       // صافي إيراد المشروبات من كل الفواتير
  withdrawals: number;      // السحوبات المفعّلة فقط (تشمل القديمة)
  deposits: number;         // الإضافات المفعّلة فقط (انتهت مهلة التفعيل) — لا تُترك صفراً
};

const ZERO_LIVE: ShiftLive = {
  sessionCash: 0, sessionTime: 0, storeCash: 0, fawryCash: 0, printerCash: 0,
  matchViewingCash: 0, miscCash: 0, miscBySource: {}, foodCash: 0, drinksCash: 0,
  withdrawals: 0, deposits: 0,
};

/** دفتر الوردية الموحّد: القيم المحفوظة للوردية المغلقة، والقيم الحية للوردية المفتوحة (أو كاحتياط عند غياب الحقول). */
type ShiftLedger = ShiftLive & {
  open: boolean;
  netMovement: number;          // = deposits − withdrawals
  netTotal: number;             // = totalRevenue + deposits − withdrawals
  grandTotalWithFloat: number;  // = netTotal + openingFloat
  miscKnownTotal: number;
};

function ledgerOf(sh: Shift, live: ShiftLive = ZERO_LIVE): ShiftLedger {
  const open = sh.status === 'open' || sh.endedAt == null;
  const withdrawals = open ? live.withdrawals : (sh.withdrawals ?? 0);
  const deposits = open ? live.deposits : (sh.deposits ?? 0);
  const sessionCash = open ? live.sessionCash : (sh.sessionCash ?? 0);
  const storeCash = open ? live.storeCash : (sh.storeCash ?? 0);
  const fawryCash = open ? live.fawryCash : (sh.fawryCash ?? 0);
  const printerCash = open ? live.printerCash : (sh.printerCash ?? 0);
  const matchViewingCash = open ? live.matchViewingCash : (sh.matchViewingCash ?? 0);
  const miscCash = open ? live.miscCash : (sh.miscCash ?? 0);
  const miscBySource = open ? live.miscBySource : (sh.miscBySource ?? {});
  const sessionTime = (sh.sessionTimeCash ?? live.sessionTime);
  const foodCash = (sh.foodCash ?? live.foodCash);
  const drinksCash = (sh.drinksCash ?? live.drinksCash);
  const miscKnownTotal = Object.entries(miscBySource).filter(([, v]) => v > 0).reduce((a, [, v]) => a + v, 0);
  const netMovement = deposits - withdrawals;
  // إجمالي الإيراد = صافي وقت الأجهزة + المأكولات + المشروبات + فوري + طابعة + مشاهدة + أخرى —
  // كل طلب يُحسب مرة واحدة فقط (المأكولات/المشروبات تشمل بيع الكاشير وطلبات الجلسات معاً،
  // ووقت الأجهزة صافٍ بدون الطلبات) فيطابق الأعمدة المَعروضة بلا ازدواج.
  const totalRevenue = sessionTime + foodCash + drinksCash + fawryCash + printerCash + matchViewingCash + miscCash;
  const netTotal = totalRevenue + deposits - withdrawals;
  const grandTotalWithFloat = netTotal + (sh.openingFloat ?? 0);
  return {
    open, sessionCash, sessionTime, storeCash, fawryCash, printerCash, matchViewingCash,
    miscCash, miscBySource, foodCash, drinksCash, withdrawals, deposits,
    netMovement, netTotal, grandTotalWithFloat, miscKnownTotal,
  };
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('settings');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙ لوحة الإدارة</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="admin-tabs">
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>الأجهزة والأسعار</button>
          <button className={tab === 'inventory' ? 'on' : ''} onClick={() => setTab('inventory')}>المخزون</button>
          <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>التقارير</button>
          <button className={tab === 'peaks' ? 'on' : ''} onClick={() => setTab('peaks')}>⚡ أوقات الذروة</button>
          <button className={tab === 'withdrawals' ? 'on' : ''} onClick={() => setTab('withdrawals')}>💸 سحب وإضافة</button>
          <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>المستخدمون</button>
          <button className={tab === 'customers' ? 'on' : ''} onClick={() => setTab('customers')}>🧑‍🤝‍🧑 الزبائن</button>
          <button className={tab === 'matches' ? 'on' : ''} onClick={() => setTab('matches')}>🔔 إدارة المباريات والتنبيهات</button>
        </div>

        {tab === 'settings' && <SettingsTab />}
        {tab === 'inventory' && <InventoryTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'peaks' && <PeaksTab />}
        {tab === 'withdrawals' && <WithdrawalsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'matches' && <MatchesTab />}
        {tab === 'customers' && <CustomersTab />}
      </div>
    </div>
  );
}

const INCOME_TONES: IncomeTone[] = ['blue', 'green', 'amber', 'purple', 'red'];

const INCOME_TONE_LABELS: Record<IncomeTone, string> = {
  blue: 'أزرق',
  green: 'أخضر',
  amber: 'كهرماني',
  purple: 'بنفسجي',
  red: 'أحمر',
};

function SettingsTab() {
  const { devices, config, updateConfig, addDevice, removeDevice, sessions, uploadSiteImage } = useStore();
  const [name, setName] = useState('');
  const [s, setS] = useState(String(config.singleRate));
  const [m, setM] = useState(String(config.multiRate));
  const [g, setG] = useState(String(config.gameRate));
  const [mv, setMv] = useState(String(config.matchViewingRate ?? 0));
  const [msg, setMsg] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [graphicUploading, setGraphicUploading] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  const [qiList, setQiList] = useState<QuickIncomeButton[]>(
    config.quickIncomeButtons && config.quickIncomeButtons.length ? config.quickIncomeButtons : DEFAULT_QUICK_INCOME,
  );
  const [qiForm, setQiForm] = useState<{ label: string; icon: string; tone: IncomeTone }>(
    { label: '', icon: '💵', tone: 'blue' },
  );
  const [qiEditId, setQiEditId] = useState<string | null>(null);
  const [qiToDelete, setQiToDelete] = useState<QuickIncomeButton | null>(null);
  const [siteName, setSiteName] = useState<string>(config.siteName || 'بلايستيشن أحمد الشريف');
  const [savingSiteName, setSavingSiteName] = useState(false);

  const [alerts, setAlerts] = useState<AlertSounds>(config.alertSounds || DEFAULT_CONFIG.alertSounds);
  const [savingAlerts, setSavingAlerts] = useState(false);
  // اختيار الجهاز الجاري تعديل أصواته: ALL_DEVICES_ID = الأصوات الافتراضية العامة، وإلا Device.id.
  const [audioDevice, setAudioDevice] = useState<string>(ALL_DEVICES_ID);
  const [deviceAlerts, setDeviceAlerts] = useState<Record<string, Partial<AlertSounds>>>(config.deviceAlertSounds || {});

  // قيمة حدث صوتي في السياق المختار (عام أو جهاز محدد) — حدث فارغ على جهاز يعود للصوت العام.
  const alertValue = (key: keyof AlertSounds): string =>
    audioDevice === ALL_DEVICES_ID ? alerts[key] : (deviceAlerts[audioDevice]?.[key] ?? '');

  const setDeviceAlert = (key: keyof AlertSounds, value: string) => {
    if (audioDevice === ALL_DEVICES_ID) {
      setAlerts((prev) => ({ ...prev, [key]: value }));
      return;
    }
    setDeviceAlerts((prev) => ({ ...prev, [audioDevice]: { ...prev[audioDevice], [key]: value } }));
  };

  const saveAlerts = async () => {
    if (savingAlerts) return;
    setSavingAlerts(true);
    try {
      // تنظيف إدخالات الأجهزة المحذوفة قبل الحفظ (لا تُترك مفاتيح ميتة في السجل).
      const liveIds = new Set(devices.map((d) => d.id));
      const deviceAlertSounds = Object.fromEntries(Object.entries(deviceAlerts).filter(([id]) => liveIds.has(id)));
      await updateConfig({ alertSounds: alerts, deviceAlertSounds });
      setMsg('تم حفظ إعدادات الأصوات بنجاح');
    } catch {
      setMsg('فشل حفظ إعدادات الأصوات');
    } finally {
      setTimeout(() => { setSavingAlerts(false); setMsg(''); }, 1800);
    }
  };

  const saveSiteName = async () => {
    if (savingSiteName) return;
    const next = siteName.trim() || 'بلايستيشن أحمد الشريف';
    setSiteName(next);
    setSavingSiteName(true);
    try {
      await updateConfig({ siteName: next });
      setMsg('تم حفظ اسم الموقع بنجاح');
    } catch {
      setMsg('فشل حفظ اسم الموقع');
    } finally {
      setTimeout(() => { setSavingSiteName(false); setMsg(''); }, 1800);
    }
  };

  const qiLoadForm = (b: QuickIncomeButton) =>
    setQiForm({ label: b.label, icon: b.icon, tone: b.tone });

  const qiResetForm = () => {
    setQiForm({ label: '', icon: '💵', tone: 'blue' });
    setQiEditId(null);
  };

  const qiSave = async () => {
    const label = qiForm.label.trim();
    if (!label) {
      setMsg('أدخل اسماً للزر');
      return;
    }
    const btn: QuickIncomeButton = {
      id: qiEditId ?? `qi-${Date.now().toString(36)}`,
      label,
      icon: qiForm.icon.trim() || '💵',
      tone: qiForm.tone,
    };
    const next = qiEditId ? qiList.map((b) => (b.id === btn.id ? btn : b)) : [...qiList, btn];
    setQiList(next);
    try {
      await updateConfig({ quickIncomeButtons: next });
      setMsg(qiEditId ? 'تم تعديل الزر وحفظه' : 'تم إضافة الزر وحفظه');
    } catch {
      setMsg('فشل الحفظ في قاعدة البيانات');
    }
    setTimeout(() => setMsg(''), 2000);
    qiResetForm();
  };

  const qiDelete = async (btn: QuickIncomeButton) => {
    const next = qiList.filter((b) => b.id !== btn.id);
    setQiList(next);
    setQiToDelete(null);
    try {
      await updateConfig({ quickIncomeButtons: next });
      setMsg('تم حذف الزر');
    } catch {
      setMsg('فشل الحذف في قاعدة البيانات');
    }
    setTimeout(() => setMsg(''), 2000);
  };

  const saveRates = async () => {
    await updateConfig({
      singleRate: Number(s) || 0,
      multiRate: Number(m) || 0,
      gameRate: Number(g) || 0,
      matchViewingRate: Number(mv) || 0,
    });
    setMsg('تم حفظ الأسعار');
    setTimeout(() => setMsg(''), 2000);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMsg('حجم الملف يتجاوز 2 ميجابايت');
      return;
    }
    setLogoUploading(true);
    try {
      const url = await uploadSiteImage(file);
      await updateConfig({ logoUrl: url });
      setMsg('تم تحديث الشعار بنجاح');
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('فشل رفع الشعار');
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const handleGraphicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMsg('حجم الملف يتجاوز 2 ميجابايت');
      return;
    }
    setGraphicUploading(true);
    try {
      const url = await uploadSiteImage(file);
      await updateConfig({ deviceGraphicUrl: url });
      setMsg('تم تحديث صورة الجهاز بنجاح');
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('فشل رفع الصورة');
    } finally {
      setGraphicUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="admin-body">
      <section>
        <h4>اسم الموقع / المحل</h4>
        <div className="maintenance-row">
          <div>
            <strong>الاسم الظاهر في رأس التطبيق</strong>
            <p className="device-hint">
              يُعرض كعنوان رئيسي في الشريط العلوي. اتركه فارغاً للعودة إلى الاسم الافتراضي.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              onBlur={() => void saveSiteName()}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveSiteName(); }}
              placeholder="بلايستيشن أحمد الشريف"
              style={{ maxWidth: 260 }}
            />
            <button className="btn" onClick={() => void saveSiteName()} disabled={savingSiteName} style={savingSiteName ? { color: 'var(--green)' } : undefined}>
              {savingSiteName ? 'تم الحفظ ✓' : 'حفظ'}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h4>شعار الموقع</h4>
        <div className="maintenance-row">
          <div>
            <strong>تغيير شعار الموقع أو صورة البروفايل</strong>
            <p className="device-hint">
              الصورة المختارة ستظهر في أعلى اللوحة وشاشة تسجيل الدخول. الحد الأقصى 2 ميجابايت.
            </p>
          </div>
          <label className="btn primary" style={{ cursor: logoUploading ? 'not-allowed' : 'pointer', opacity: logoUploading ? 0.6 : 1 }}>
            {logoUploading ? 'جارٍ الرفع…' : '📷 تغيير الشعار'}
            <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} disabled={logoUploading} />
          </label>
        </div>
      </section>

      <section>
        <h4>صورة الجهاز على كروت الأجهزة</h4>
        <div className="maintenance-row">
          <div>
            <strong>بلايستيشن 4 أو شاشة عرض</strong>
            <p className="device-hint">
              الصورة تظهر كقطعة مركزية أعلى عداد كل جهاز في لوحة التحكم. ارفع صورة واضحة للجهاز أو الشاشة
              (الحد الأقصى 2 ميجابايت) لتظهر على جميع الكروت مباشرة. عند تفريغها يعود الرسم الافتراضي تلقائياً.
            </p>
            {config.deviceGraphicUrl && (
              <img className="settings-thumb" src={config.deviceGraphicUrl} alt="صورة الجهاز الحالية" />
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <label className="btn primary" style={{ cursor: graphicUploading ? 'not-allowed' : 'pointer', opacity: graphicUploading ? 0.6 : 1 }}>
              {graphicUploading ? 'جارٍ الرفع…' : '📷 تغيير صورة الجهاز'}
              <input type="file" accept="image/*" onChange={handleGraphicUpload} style={{ display: 'none' }} disabled={graphicUploading} />
            </label>
            {config.deviceGraphicUrl && (
              <button className="btn ghost" onClick={() => void updateConfig({ deviceGraphicUrl: '' })}>
                استعادة الرسم الافتراضي
              </button>
            )}
          </div>
        </div>
      </section>

      <section>
        <h4>أزرار الإيرادات السريعة ({qiList.length})</h4>
        <p className="device-hint">
          هذه الأزرار تظهر في الشريط العلوي للوحة، وكلها تفتح نفس نافذة تسجيل الإيراد (المبلغ + ملاحظة + طباعة إيصال).
          يمكنك إضافة أو تعديل أو حذف الأزرار بحرية — يُحفظ التكوين في قاعدة البيانات ويعمل فوراً على جميع الأجهزة.
        </p>
        <div className="qi-list">
          {qiList.map((b) => (
            <div key={b.id} className="qi-row">
              <span className={`qi-icon qib qib-${b.tone}`}>{b.icon}</span>
              <div className="qi-info">
                <strong>{b.label}</strong>
                <span className="cell-detail">إيراد سريع · يُسجل تلقائياً في فئة "إيرادات أخرى"</span>
              </div>
              <div className="cell-actions">
                <button className="btn tiny" onClick={() => { qiLoadForm(b); setQiEditId(b.id); }}>تعديل</button>
                <button className="btn tiny danger-text" onClick={() => setQiToDelete(b)}>حذف</button>
              </div>
            </div>
          ))}
        </div>

        <div className="qi-form">
          <input
            placeholder="اسم الزر (مثال: شحن رصيد)"
            value={qiForm.label}
            onChange={(e) => setQiForm({ ...qiForm, label: e.target.value })}
          />
          <input
            placeholder="أيقونة"
            value={qiForm.icon}
            onChange={(e) => setQiForm({ ...qiForm, icon: e.target.value })}
            style={{ width: 90 }}
          />
          <select value={qiForm.tone} onChange={(e) => setQiForm({ ...qiForm, tone: e.target.value as IncomeTone })}>
            {INCOME_TONES.map((t) => (
              <option key={t} value={t}>{INCOME_TONE_LABELS[t]}</option>
            ))}
          </select>
          <button className="btn primary" onClick={() => void qiSave()}>{qiEditId ? 'حفظ التعديل' : '+ إضافة زر'}</button>
          {qiEditId && <button className="btn ghost" onClick={qiResetForm}>إلغاء</button>}
        </div>
        {msg && <p className="ok-msg">{msg}</p>}
      </section>

      {qiToDelete && (
        <ConfirmDialog
          title="حذف زر إيراد سريع"
          message={`هل أنت متأكد من حذف زر "${qiToDelete.label}"؟ لن يظهر في الشريط العلوي، لكن العمليات المالية التي سُجلت به سابقاً ستظل محفوظة في التقارير.`}
          confirmLabel="حذف"
          onConfirm={() => qiDelete(qiToDelete)}
          onClose={() => setQiToDelete(null)}
        />
      )}

      {msg && <p className="ok-msg">{msg}</p>}

      <section>
        <h4>أجهزة بلايستيشن ({devices.length})</h4>
        <div className="device-admin-list">
          {devices.map((d) => {
            const busy = sessions.some((x) => x.deviceId === d.id);
            return (
              <div key={d.id} className="device-admin-row">
                <span>🎮 {d.name}</span>
                <div>
                  {busy && <span className="tag">قيد الاستخدام</span>}
                  <button
                    className="btn tiny danger-text"
                    onClick={() => setDeviceToDelete(d)}
                  >
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="inline-add">
          <input placeholder="اسم الجهاز الجديد" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => { void addDevice(name); setName(''); }}>+ إضافة جهاز</button>
        </div>
      </section>

      <section>
        <h4>الأسعار</h4>
        <div className="rates-grid four">
          <div>
            <label className="field-label">سعر فردي (Single) / ساعة</label>
            <input type="number" min={0} value={s} onChange={(e) => setS(e.target.value)} />
          </div>
          <div>
            <label className="field-label">سعر ملتي (Multi) / ساعة</label>
            <input type="number" min={0} value={m} onChange={(e) => setM(e.target.value)} />
          </div>
          <div>
            <label className="field-label">سعر الجيم الواحد</label>
            <input type="number" min={0} value={g} onChange={(e) => setG(e.target.value)} />
          </div>
          <div>
            <label className="field-label">سعر مشاهدة المباريات / ساعة</label>
            <input type="number" min={0} value={mv} onChange={(e) => setMv(e.target.value)} />
          </div>
        </div>
        {msg && <p className="ok-msg">{msg}</p>}
        <button className="btn primary" onClick={() => void saveRates()}>حفظ الأسعار</button>
      </section>

      <section className={config.maintenanceMode ? 'danger-zone' : ''}>
        <h4>🛠 وضع الصيانة</h4>
        <div className="maintenance-row">
          <div>
            <strong>{config.maintenanceMode ? 'وضع الصيانة مفعّل حالياً' : 'وضع الصيانة مطفّأ'}</strong>
            <p className="device-hint">
              عند التفعيل، يُمنع الموظفون من تسجيل الدخول أو تنفيذ أي عمليات (حتى لو كانوا مسجّلين دخولهم بالفعل)، ويبقى الوصول متاحاً للمدير فقط.
            </p>
          </div>
          <button
            type="button"
            className={`switch ${config.maintenanceMode ? 'on' : ''}`}
            role="switch"
            aria-checked={config.maintenanceMode}
            onClick={() => void updateConfig({ maintenanceMode: !config.maintenanceMode })}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </section>

      <section>
        <h4>🔔 إعدادات الأصوات والتنبيهات</h4>
        <p className="device-hint" style={{ marginBottom: 12 }}>
          اختر جهازاً معيناً لتخصيص أصواته، أو «جميع الأجهزة» لتعديل الأصوات الافتراضية لكل النظام.
          الحقل الفارغ على جهاز محدد = «يستخدم الصوت الافتراضي العام». تُطبَّق التغييرات فور الحفظ.
        </p>
        <div className="rates-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <div>
            <label className="field-label">الجهاز</label>
            <select className="cat-select" value={audioDevice} onChange={(e) => setAudioDevice(e.target.value)}>
              <option value={ALL_DEVICES_ID}>جميع الأجهزة (افتراضي)</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">النطاق الحالي</label>
            <div className="device-hint" style={{ margin: 0, alignSelf: 'center', paddingTop: 10 }}>
              {audioDevice === ALL_DEVICES_ID
                ? '🌐 تعديل الأصوات الافتراضية — تنطبق على كل الأجهزة التي لا تملك صوتاً مخصصاً لهذا الحدث.'
                : `🎮 تخصيص أصوات "${devices.find((d) => d.id === audioDevice)?.name ?? 'الجهاز المحدد'}" فقط — الحدث الفارغ يعود للصوت الافتراضي العام.`}
            </div>
          </div>
        </div>
        <div className="rates-grid">
          <div>
            <label className="field-label">بدء الجلسة</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionStarted')} onChange={(e) => setDeviceAlert('sessionStarted', e.target.value)} />
          </div>
          <div>
            <label className="field-label">انتهاء الوقت الأصلي للجلسة</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionExpired')} onChange={(e) => setDeviceAlert('sessionExpired', e.target.value)} />
          </div>
          <div>
            <label className="field-label">اقتراب انتهاء الوقت الأصلي</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('almostUp')} onChange={(e) => setDeviceAlert('almostUp', e.target.value)} />
          </div>
          <div>
            <label className="field-label">تمديد وقت الجلسة</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionExtended')} onChange={(e) => setDeviceAlert('sessionExtended', e.target.value)} />
          </div>
          <div>
            <label className="field-label">إلغاء الجلسة بدون تحصيل</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionCancelled')} onChange={(e) => setDeviceAlert('sessionCancelled', e.target.value)} />
          </div>
          <div>
            <label className="field-label">تم تحصيل المبلغ</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('paymentCollected')} onChange={(e) => setDeviceAlert('paymentCollected', e.target.value)} />
          </div>
          <div>
            <label className="field-label">توقف مؤقت للجلسة</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionPaused')} onChange={(e) => setDeviceAlert('sessionPaused', e.target.value)} />
          </div>
          <div>
            <label className="field-label">استئناف الجلسة</label>
            <input type="text" dir="ltr" placeholder={audioDevice === ALL_DEVICES_ID ? 'رابط ملف الصوت' : 'فارغ = الصوت الافتراضي'} value={alertValue('sessionResumed')} onChange={(e) => setDeviceAlert('sessionResumed', e.target.value)} />
          </div>
        </div>
        <button className="btn primary" onClick={() => void saveAlerts()} disabled={savingAlerts}>
          {savingAlerts ? 'جارٍ الحفظ…' : 'حفظ إعدادات الأصوات'}
        </button>
      </section>

      {deviceToDelete && (
        <ConfirmDialog
          title={`حذف الجهاز ${deviceToDelete.name}`}
          message={`هل أنت متأكد من حذف الجهاز "${deviceToDelete.name}" نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`}
          confirmLabel="حذف"
          onConfirm={() => { void removeDevice(deviceToDelete.id).catch((e) => alert(e.message)); setDeviceToDelete(null); }}
          onClose={() => setDeviceToDelete(null)}
        />
      )}
    </div>
  );
}

function InventoryTab() {
  const { inventory, config, addInventoryItem, updateInventoryItem, deleteInventoryItem } = useStore();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState<ItemCategory>('drinks');
  const [err, setErr] = useState('');
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

  const add = async () => {
    const p = Number(price), c = Number(cost), st = Number(stock);
    if (!name.trim() || Number.isNaN(p) || Number.isNaN(st)) {
      setErr('الاسم والسعر والكمية مطلوبة');
      return;
    }
    await addInventoryItem(name.trim(), p, Number.isNaN(c) ? 0 : c, st, category);
    setName(''); setPrice(''); setCost(''); setStock(''); setErr('');
  };

  return (
    <div className="admin-body">
      <section>
        <h4>منتجات المخزون</h4>
        <table className="tbl">
          <thead>
            <tr><th>المنتج</th><th>التصنيف</th><th>سعر البيع</th><th>التكلفة</th><th>الكمية</th><th></th></tr>
          </thead>
          <tbody>
            {inventory.map((item) => (
              <tr key={item.id} className={item.stock <= 5 ? 'low-stock' : ''}>
                <td>{item.name}</td>
                <td>
                  <select
                    className="cat-select"
                    value={item.category ?? 'drinks'}
                    onChange={(e) => void updateInventoryItem(item.id, { category: e.target.value as ItemCategory })}
                  >
                    <option value="drinks">مشروبات</option>
                    <option value="food">مأكولات</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number" min={0} value={item.price}
                    onChange={(e) => void updateInventoryItem(item.id, { price: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    type="number" min={0} value={item.cost}
                    onChange={(e) => void updateInventoryItem(item.id, { cost: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <input
                    type="number" min={0} value={item.stock}
                    onChange={(e) => void updateInventoryItem(item.id, { stock: Number(e.target.value) || 0 })}
                  />
                </td>
                <td>
                  <button
                    className="btn tiny danger-text"
                    onClick={() => setItemToDelete({ id: item.id, name: item.name })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inventory.length === 0 && <p className="device-hint">لا توجد منتجات — أضف أول منتج من الأسفل.</p>}
      </section>

      <section>
        <h4>إضافة منتج</h4>
        <div className="rates-grid four">
          <div><label className="field-label">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: كولا" /></div>
          <div>
            <label className="field-label">التصنيف</label>
            <select className="cat-select" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
              <option value="drinks">مشروبات</option>
              <option value="food">مأكولات</option>
            </select>
          </div>
          <div><label className="field-label">سعر البيع ({config.currency})</label><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15" /></div>
          <div><label className="field-label">التكلفة</label><input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="10" /></div>
          <div><label className="field-label">الكمية</label><input type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="20" /></div>
        </div>
        {err && <p className="modal-error">{err}</p>}
        <button className="btn primary" onClick={() => void add()}>+ إضافة منتج</button>
      </section>

      {itemToDelete && (
        <ConfirmDialog
          title={`حذف المنتج ${itemToDelete.name}`}
          message={`هل أنت متأكد من حذف المنتج "${itemToDelete.name}" نهائياً من المخزون؟ لا يمكن التراجع عن هذا الإجراء.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteInventoryItem(itemToDelete.id); setItemToDelete(null); }}
          onClose={() => setItemToDelete(null)}
        />
      )}
    </div>
  );
}

function ReportsTab() {
  const { sales, shifts, config, deleteShift, openShifts, withdrawals, shiftReports, deleteShiftReport } = useStore();
  const [day, setDay] = useState(dayKey(Date.now()));
  const [purgeScope, setPurgeScope] = useState<'old' | 'all' | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<{ id: string; label: string } | null>(null);
  const [reportToView, setReportToView] = useState<Shift | null>(null);
  const [reportToDelete, setReportToDelete] = useState<ShiftReport | null>(null);

  // ورديات اليوم المحدد + النقدية الافتتاحية المقابلة لها
  const dayShifts = useMemo(() => {
    const start = new Date(day + 'T00:00:00').getTime();
    const end = start + 86400000;
    return shifts.filter((sh) => sh.startedAt >= start && sh.startedAt < end);
  }, [shifts, day]);
  const openingCash = useMemo(() => dayShifts.reduce((a, sh) => a + (sh.openingFloat ?? 0), 0), [dayShifts]);

  // نقدية افتتاح الوردية النشطة الحالية (مهما كان يوم بدايتها) — يُعالج الخلل الذي كان يتجاهل
  // الافتتاحي للوردية المفتوحة. للأيام الماضية (ورديات مغلقة كاملة) تُحسب من ورديات اليوم نفسه.
  const today = dayKey(Date.now());
  const activeOpeningFloat = day === today ? (openShifts[0]?.openingFloat ?? 0) : 0;

  // الحسابات الحية لكل وردية من سجلات المبيعات وحركات الخزنة — تطابق تماماً منطق shiftTotals
  // عند التقفيل (يعمل على المصفوفات المحلية المزامنة). تُستخدم للوردية المفتوحة وللورديات
  // المغلقة القديمة التي تنقصها حقول التفصيل المحفوظة. الإضافات تُحتسب فقط بعد انتهاء مهلة
  // التفعيل (activateAt <= الآن) فلا تُترك قيم السحوبات/الإضافات صفراً مع وجود حركات نشطة.
  const shiftLive = useMemo(() => {
    const map = new Map<string, ShiftLive>();
    const bump = (id: string): ShiftLive => {
      let r = map.get(id);
      if (!r) { r = { ...ZERO_LIVE, miscBySource: {} }; map.set(id, r); }
      return r;
    };
    const now = Date.now();
    for (const sale of sales) {
      if (!sale.shiftId) continue;
      const r = bump(sale.shiftId);
      if (sale.type === 'session') {
        r.sessionCash += sale.total;
        r.sessionTime += sale.timeCost + (sale.gamesCost ?? 0);
      } else if (sale.type === 'fawry') r.fawryCash += sale.total;
      else if (sale.type === 'printer') r.printerCash += sale.total;
      else if (sale.type === 'matchViewing') r.matchViewingCash += sale.total;
      else if (sale.type === 'misc') {
        r.miscCash += sale.total;
        const k = (sale.source && sale.source.trim()) || 'إيراد آخر';
        r.miscBySource[k] = (r.miscBySource[k] || 0) + sale.total;
      } else r.storeCash += sale.total;
      // المأكولات/المشروبات من كل الفواتير (بيع مباشر + طلبات الجلسات) صافي الخصومات.
      let saleFood = 0;
      let saleDrinks = 0;
      for (const o of sale.orders) {
        const cat: ItemCategory = o.category ?? classifyItem(o.name);
        const net = orderLineNet(o);
        if (cat === 'food') saleFood += net;
        else saleDrinks += net;
      }
      if (sale.type === 'store') {
        saleFood = Math.max(0, saleFood - (sale.discountByCategory?.food ?? 0));
        saleDrinks = Math.max(0, saleDrinks - (sale.discountByCategory?.drinks ?? 0));
      }
      r.foodCash += Math.round(saleFood * 100) / 100;
      r.drinksCash += Math.round(saleDrinks * 100) / 100;
    }
    for (const w of withdrawals) {
      if (!w.shiftId) continue;
      if (w.activateAt && w.activateAt > now) continue;
      const r = bump(w.shiftId);
      if ((w.type ?? 'withdraw') === 'deposit') r.deposits += w.amount || 0;
      else r.withdrawals += w.amount || 0;
    }
    return map;
  }, [sales, withdrawals]);

  // أعمدة الإيرادات الأخرى: عمود لكل اسم زر مخصص (مثل "شحن رصيد") بدلاً من عمود "أخرى" العام.
  const miscCols = useMemo(() => {
    const names = new Set<string>();
    let needsFallback = false;
    for (const sh of shifts) {
      const ledger = ledgerOf(sh, shiftLive.get(sh.id));
      let knownTotal = 0;
      for (const [n, v] of Object.entries(ledger.miscBySource)) {
        if (v > 0) {
          names.add(n);
          knownTotal += v;
        }
      }
      if (ledger.miscCash - knownTotal > 0) needsFallback = true;
    }
    return { cols: [...names], needsFallback };
  }, [shifts, shiftLive]);

  // الإيرادات اليومية للتاريخ المحدد — تُحسب ديناميكياً فقط من ورديات اليوم (سجل الورديات) عبر دفتر
  // الوردية الموحّد: القيم المحفوظة عند التقفيل، والحية للوردية المفتوحة أو للسجلات القديمة الناقصة
  // (وقت الأجهزة + المأكولات + المشروبات + فوري + الطابعة + مشاهدة المباريات + إيرادات أخرى) —
  // من دون أي قراءة مباشرة من سجل المبيعات/المعاملات.
  const rev = useMemo(() => {
    let devices = 0;
    let drinks = 0;
    let food = 0;
    let fawry = 0;
    let printer = 0;
    let match = 0;
    let misc = 0;
    const miscBySource: Record<string, number> = {};
    for (const sh of dayShifts) {
      const l = ledgerOf(sh, shiftLive.get(sh.id));
      devices += l.sessionTime;
      food += l.foodCash;
      drinks += l.drinksCash;
      fawry += l.fawryCash;
      printer += l.printerCash;
      match += l.matchViewingCash;
      misc += l.miscCash;
      for (const [k, v] of Object.entries(l.miscBySource)) {
        if (v > 0) miscBySource[k] = (miscBySource[k] || 0) + v;
      }
    }
    const total = devices + food + drinks + fawry + printer + match + misc;
    return { devices, drinks, food, fawry, printer, matchViewing: match, misc, miscBySource: Object.entries(miscBySource).filter(([, v]) => v > 0), total };
  }, [dayShifts, shiftLive]);

  // صافي حركة الخزنة لليوم المعروض (إضافة − سحب) من دفتر كل وردية — الإضافات قيد التأجيل لا تُحتسب.
  const dayNetMovement = useMemo(() => {
    let deposits = 0;
    let withdrawalsSum = 0;
    for (const sh of dayShifts) {
      const l = ledgerOf(sh, shiftLive.get(sh.id));
      deposits += l.deposits;
      withdrawalsSum += l.withdrawals;
    }
    return deposits - withdrawalsSum;
  }, [dayShifts, shiftLive]);

  // الإيراد الكلي بعد دمج صافي حركة الخزنة، مضافاً إليه النقدية الافتتاحية:
  // Card = (إيراد ورديات اليوم + صافي الخزنة) + نقدية فتح الوردية النشطة
  const revenueWithNet = rev.total + dayNetMovement;
  const totalRevenueWithOpening = revenueWithNet + (activeOpeningFloat || openingCash);

  return (
    <div className="admin-body">
      <section>
        <h4>إيرادات يومية — {day}</h4>
        <div className="rates-grid">
          <div>
            <label className="field-label">التاريخ</label>
            <input type="date" value={day} max={dayKey(Date.now())} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>
        <div className="stat-row auto">
          <div className="stat"><span>إيراد الأجهزة</span><strong>{money(rev.devices, config.currency)}</strong></div>
          <div className="stat"><span>إيراد المشروبات</span><strong>{money(rev.drinks, config.currency)}</strong></div>
          <div className="stat"><span>إيراد المأكولات</span><strong>{money(rev.food, config.currency)}</strong></div>
          <div className="stat"><span>إيراد ماكنة فوري</span><strong>{money(rev.fawry, config.currency)}</strong></div>
          <div className="stat"><span>إيراد الطابعة</span><strong>{money(rev.printer, config.currency)}</strong></div>
          <div className="stat"><span>إيراد مشاهدة المباريات</span><strong>{money(rev.matchViewing, config.currency)}</strong></div>
          {rev.miscBySource.map(([name, v]) => (
            <div className="stat" key={name}><span>{name}</span><strong>{money(v, config.currency)}</strong></div>
          ))}
          <div className="stat accent"><span>الإيراد الكلي</span><strong>{money(revenueWithNet, config.currency)}</strong></div>
          <div className={`stat ${dayNetMovement > 0 ? 'accent' : dayNetMovement < 0 ? 'danger' : ''}`}>
            <span>صافي حركة الخزنة (إضافة − سحب)</span>
            <strong>{signedMoney(dayNetMovement, config.currency)}</strong>
          </div>
          <div className="stat accent">
            <span>الإيراد + النقدية الافتتاحية</span>
            <strong>{money(totalRevenueWithOpening, config.currency)}</strong>
          </div>
        </div>
      </section>

      <section>
        <h4>تقارير الورديات</h4>
        <div className="shift-reports-list">
          {shiftReports.map((rp) => {
            // التقرير يُفتح من سجل الوردية الحيّ إن وُجد، وإلا يُبنى من لقطة التقرير المؤرشفة كاملة.
            const shift = shifts.find((s) => s.id === rp.id) ?? {
              id: rp.id, staff: rp.staff, role: rp.role, startedAt: rp.startedAt, endedAt: rp.endedAt ?? null,
              openingFloat: rp.openingFloat ?? 0, sessionCash: 0, storeCash: 0, fawryCash: 0,
              printerCash: 0, matchViewingCash: 0, miscCash: 0, withdrawals: 0, total: rp.total, status: 'closed',
            } as Shift;
            return (
              <div key={rp.id} className="shift-report-card" onClick={() => setReportToView(shift)}>
                <span className="shift-report-glow" aria-hidden="true" />
                <div className="shift-report-body">
                  <strong className="shift-report-title">
                    {rp.staff} — {fmtDateTimeFull(rp.startedAt)}
                  </strong>
                </div>
                <button
                  className="shift-report-del"
                  onClick={(e) => { e.stopPropagation(); setReportToDelete(rp); }}
                  title="حذف التقرير نهائياً من قاعدة البيانات"
                  aria-label="حذف التقرير"
                >
                  <Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        {shiftReports.length === 0 && (
          <p className="device-hint">
            لا توجد تقارير ورديات محفوظة بعد — ارفض إشعار «نهاية/تقرير الوردية» من جرس الإشعارات
            ليُؤرشف تقرير الوردية الكامل هنا.
          </p>
        )}
      </section>

      <section>
        <h4>سجل الورديات</h4>
        <div style={{ overflowX: 'auto' }}>
        <table className="tbl money-tbl">
          <thead><tr><th>الموظف</th><th>البداية</th><th>النهاية</th><th>النقدية الافتتاحية</th><th>الجلسات</th><th>المأكولات</th><th>المشروبات</th><th>فوري</th><th>الطابعة</th><th>مشاهدة المباريات</th>{miscCols.cols.map((n) => <th key={n}>{n}</th>)}{miscCols.needsFallback && <th>إيراد آخر</th>}<th>السحوبات</th><th>الإضافات</th><th>صافي الحركة</th><th>الإجمالي</th><th>الإجمالي + الافتتاحي</th><th></th></tr></thead>
          <tbody>
            {shifts.map((sh) => {
              const ledger = ledgerOf(sh, shiftLive.get(sh.id));
              const miscEntries = Object.entries(ledger.miscBySource).filter(([, v]) => v > 0);
              // الإجمالي الصافي = (كل مكونات الإيراد) + الإضافات − السحوبات — بنفس الصيغة الموحّدة
              // في جدول سجل الورديات ونافذة التفاصيل وسجل حركة الخزنة. السالب يُحفظ كما هو.
              return (
              <tr key={sh.id}>
                <td>{sh.staff}</td>
                <td>{fmtDateTimeFull(sh.startedAt)}</td>
                <td>{sh.endedAt ? fmtDateTimeFull(sh.endedAt) : <span className="tag">مفتوحة</span>}</td>
                <td>{money(sh.openingFloat ?? 0, config.currency)}</td>
                {/* الجلسات = إيراد وقت اللعب الصافي فقط (بدون الطلبات/الكافتيريا) */}
                <td>{money(ledger.sessionTime, config.currency)}</td>
                <td>{money(ledger.foodCash, config.currency)}</td>
                <td>{money(ledger.drinksCash, config.currency)}</td>
                <td>{money(ledger.fawryCash, config.currency)}</td>
                <td>{money(ledger.printerCash, config.currency)}</td>
                <td>{money(ledger.matchViewingCash, config.currency)}</td>
                {miscCols.cols.map((n) => (
                  <td key={n}>{money(ledger.miscBySource[n] ?? 0, config.currency)}</td>
                ))}
                {miscCols.needsFallback && (
                  <td>{money(Math.max(0, ledger.miscCash - ledger.miscKnownTotal), config.currency)}</td>
                )}
                <td>{money(ledger.withdrawals, config.currency)}</td>
                <td className="accent-text">{money(ledger.deposits, config.currency)}</td>
                <td className={ledger.netMovement > 0 ? 'accent-text' : ledger.netMovement < 0 ? 'danger-text' : ''}>
                  <strong>{signedMoney(ledger.netMovement, config.currency)}</strong>
                </td>
                <td><strong>{money(ledger.netTotal, config.currency)}</strong></td>
                <td><strong>{money(ledger.grandTotalWithFloat, config.currency)}</strong></td>
                <td className="cell-actions">
                  <button className="btn tiny danger-text" onClick={() => setShiftToDelete({ id: sh.id, label: sh.staff })}>✕</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      <section className="danger-zone">
        <h4>⚠ صيانة قاعدة البيانات</h4>
        <p className="device-hint">
          حذف نهائي ودائم من قاعدة بيانات Firestore السحابية لسجلات المبيعات والمعاملات
          (جلسات، بيع مباشر، فوري، الطابعة، مشاهدة المباريات) وسجلات السحوبات النقدية.
          هذه الإجراءات نهائية ولا يمكن التراجع عنها.
        </p>
        <div className="danger-actions">
          <button className="btn danger" onClick={() => setPurgeScope('old')}>
            🗑 حذف السجلات الأقدم من 5 أيام
          </button>
          <button className="btn danger" onClick={() => setPurgeScope('all')}>
            💥 حذف كل المبيعات والمعاملات نهائياً (تنظيف بيانات التجربة)
          </button>
        </div>
      </section>

      {purgeScope && <PurgeSalesModal scope={purgeScope} onClose={() => setPurgeScope(null)} />}
      {reportToView && <ShiftSummaryModal shift={reportToView} onClose={() => setReportToView(null)} />}
      {reportToDelete && (
        <ConfirmDialog
          title="حذف تقرير وردية"
          message={`هل أنت متأكد من حذف تقرير وردية "${reportToDelete.staff}" نهائياً؟ سيُحذف معه في نفس اللحظة سجل الوردية المقابل من «سجل الورديات» (حذف متزامن ثنائي الاتجاه على Firestore) ولن يمكن التراجع.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteShiftReport(reportToDelete.id); setReportToDelete(null); }}
          onClose={() => setReportToDelete(null)}
        />
      )}
      {shiftToDelete && (
        <ConfirmDialog
          title="حذف سجل وردية"
          message={`هل أنت متأكد من حذف سجل وردية "${shiftToDelete.label}" نهائياً؟ سيُحذف معه في نفس اللحظة تقريرها المؤرشف من «تقارير الورديات» إن وُجد (حذف متزامن ثنائي الاتجاه على Firestore) ولا يمكن التراجع عن هذا الإجراء.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteShift(shiftToDelete.id); setShiftToDelete(null); }}
          onClose={() => setShiftToDelete(null)}
        />
      )}
    </div>
  );
}

const PURGE_DAYS = 5;

function PurgeSalesModal({ scope, onClose }: { scope: 'old' | 'all'; onClose: () => void }) {
  const { sales, deleteOldSales, deleteAllSales } = useStore();
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const cutoff = Date.now() - PURGE_DAYS * 86400000;
  const confirmPhrase = scope === 'old' ? 'حذف نهائي' : 'حذف كل البيانات';
  const visibleCount = useMemo(
    () => (scope === 'old' ? sales.filter((s) => s.at < cutoff).length : sales.length),
    [sales, cutoff, scope],
  );
  const canConfirm = ack && typed.trim() === confirmPhrase && !busy;

  const go = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setErr('');
    try {
      const count = scope === 'old' ? await deleteOldSales(PURGE_DAYS) : await deleteAllSales();
      setDoneCount(count);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشلت عملية الحذف');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚠ {scope === 'old' ? 'حذف نهائي للسجلات القديمة' : 'حذف نهائي لجميع السجلات'}</h3>
          {!busy && <button className="x" onClick={onClose}>×</button>}
        </div>

        {doneCount === null ? (
          <>
            {scope === 'old' ? (
              <p className="device-hint">
                سيتم حذف <strong>كل</strong> سجلات المبيعات والمعاملات (جلسات الأجهزة، البيع المباشر، ماكنة
                فوري، الطابعة، ومشاهدة المباريات) وسجلات السحوبات النقدية المسجلة قبل تاريخ {fmtDateTimeFull(cutoff)} بشكل نهائي ومباشر من قاعدة
                بيانات Firestore السحابية.
              </p>
            ) : (
              <p className="device-hint">
                سيتم حذف <strong>جميع</strong> سجلات المبيعات والمعاملات على الإطلاق وبلا استثناء — بلا نظر عن التاريخ
                أو النوع (جلسات، بيع مباشر، فوري، الطابعة، مشاهدة المباريات) وكذلك سجلات السحوبات النقدية، بشكل نهائي ومباشر من قاعدة بيانات
                Firestore السحابية. استخدم هذا فقط لتنظيف بيانات تجريبية قبل بدء العمل الفعلي.
              </p>
            )}
            <p className="device-hint">
              عدد السجلات المعروضة حالياً والمؤهلة للحذف: <strong>{visibleCount}</strong>
              {' '}(قد يشمل الحذف سجلات إضافية غير معروضة حالياً في الجدول أعلاه).
            </p>
            <p className="modal-error">❌ لا يمكن استعادة هذه البيانات بعد الحذف. تأكد جيداً قبل المتابعة.</p>

            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              أدرك أن هذا الإجراء نهائي ولا يمكن التراجع عنه
            </label>

            <label className="field-label">اكتب "{confirmPhrase}" للتأكيد</label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              disabled={busy}
            />

            {err && <p className="modal-error">{err}</p>}

            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose} disabled={busy}>تراجع</button>
              <button className="btn danger" disabled={!canConfirm} onClick={() => void go()}>
                {busy ? 'جاري الحذف…' : 'تأكيد الحذف النهائي'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ok-msg">✅ تم حذف {doneCount} سجل نهائياً من قاعدة البيانات السحابية.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * سجل حركة الخزنة النقدية (سحب/إضافة) — قسم مستقل عن المبيعات والإيرادات، يعرض كل حركة
 * باسم الموظف المنفذ ونوعها وملاحظتها. السحوبات تُخصم من إيراد الوردية عند التقفيل فوراً،
 * بينما تُفعَّل الإضافات بعد انتهاء مهلة التأجيل (دقيقتان) فتُضاف للإيراد.
 */
function WithdrawalsTab() {
  const { config, deleteWithdrawal } = useStore();
  const now = useTick(1000);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [live, setLive] = useState(false);
  const [wdToDelete, setWdToDelete] = useState<Withdrawal | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'withdrawals'), orderBy('at', 'desc'), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Withdrawal, 'id'>) })));
        setLive(true);
      },
      (err) => {
        console.error('withdrawals-tab', err);
        setLive(false);
        void getDocs(q).then((snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Withdrawal, 'id'>) }))));
      },
    );
    return unsub;
  }, []);

  const totalWd = rows
    .filter((w) => (w.type ?? 'withdraw') === 'withdraw' && !(w.activateAt && now < w.activateAt))
    .reduce((a, w) => a + (w.amount || 0), 0);
  const totalDep = rows
    .filter((w) => w.type === 'deposit' && !(w.activateAt && now < w.activateAt))
    .reduce((a, w) => a + (w.amount || 0), 0);

  return (
    <div className="admin-body">
      <section>
        <h4>سجل حركة الخزنة (سحب / إضافة) — {rows.length}</h4>
        <p className="device-hint">
          المبالغ المسحوبة من درج الخزنة أثناء الورديات تُخصم فوراً من إيراد الوردية عند التقفيل،
          والإضافات النقدية تُسجَّل أولاً «قيد التفعيل» ولا تُضاف للإيراد إلا بعد انتهاء مهلة الدقيقتين.
          كل حركة تسجَّل باسم الموظف المنفذ مع ملاحظتها، والقائمة منفصلة تماماً عن المبيعات والإيرادات.
        </p>
        <div className="stat-row four">
          <div className="stat accent"><span>إجمالي السحوبات</span><strong>{money(totalWd, config.currency)}</strong></div>
          <div className="stat"><span>إجمالي الإضافات المفعّلة</span><strong>{money(totalDep, config.currency)}</strong></div>
          <div className={`stat ${totalDep - totalWd > 0 ? 'accent' : totalDep - totalWd < 0 ? 'danger' : ''}`}>
            <span>صافي الحركة (إضافة − سحب)</span>
            <strong>{signedMoney(totalDep - totalWd, config.currency)}</strong>
          </div>
          <div className="stat"><span>الحالة</span><strong>{live ? 'مزامنة مباشرة ✓' : 'غير متصل — آخر بيانات'}</strong></div>
        </div>
        <table className="tbl">
          <thead><tr><th>النوع</th><th>الوقت</th><th>الموظف</th><th>الملاحظة</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {rows.map((w) => {
              const deposit = (w.type ?? 'withdraw') === 'deposit';
              const pending = deposit && !!w.activateAt && now < w.activateAt;
              return (
                <tr key={w.id}>
                  <td>
                    <span className={`pill ${pending ? 'pill-warn' : deposit ? 'pill-ok' : 'pill-danger'}`}>
                      {deposit ? 'إضافة' : 'سحب'}
                    </span>
                  </td>
                  <td>{fmtDateTimeFull(w.at)}</td>
                  <td>{w.staff}</td>
                  <td className="cell-detail">{w.note || '—'}</td>
                  <td>
                    <strong className={deposit ? 'accent-text' : 'danger-text'}>
                      {deposit ? '+ ' : '− '}{money(w.amount, config.currency)}
                    </strong>
                  </td>
                  <td>
                    {pending
                      ? <span className="pill pill-warn">قيد التفعيل</span>
                      : <span className="pill pill-ok">مفعّلة</span>}
                  </td>
                  <td className="cell-actions">
                    <button className="btn tiny danger-text" onClick={() => setWdToDelete(w)}>حذف</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="device-hint">لا توجد حركات نقدية مسجلة بعد.</p>}
      </section>

      {wdToDelete && (
        <ConfirmDialog
          title="حذف سجل حركة نقدية"
          message={`هل أنت متأكد من حذف ${(wdToDelete.type ?? 'withdraw') === 'deposit' ? 'إضافة' : 'سحب'} بقيمة "${money(wdToDelete.amount, config.currency)}" التي نفّذها ${wdToDelete.staff} نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteWithdrawal(wdToDelete.id); setWdToDelete(null); }}
          onClose={() => setWdToDelete(null)}
        />
      )}
    </div>
  );
}

const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const PEAK_PERIODS = [
  { days: 7, label: 'آخر 7 أيام' },
  { days: 30, label: 'آخر 30 يوم' },
  { days: 90, label: 'آخر 90 يوم' },
  { days: 0, label: 'كل الفترات' },
] as const;

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

interface HourRow { h: number; minutes: number; sessions: number }
interface DayRow { wd: number; minutes: number; sessions: number }

/**
 * تقرير أوقات الذروة — تحليل ازدحام مستقل تماماً عن أي بيانات مالية أو إيرادات.
 * يستند فقط إلى سجلات الجلسات (وقت البدء والانتهاء) مباشرة من Firestore،
 * ويوزّع دقائق التشغيل على الـ 24 ساعة وأيام الأسبوع (الأحد → السبت).
 */
function PeaksTab() {
  const [rows, setRows] = useState<Session[]>([]);
  const [live, setLive] = useState(false);
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    const q = query(collection(db, 'sessions'), orderBy('startedAt', 'desc'), limit(5000));
    const mapRows = (snap: { docs: { id: string; data: () => object }[] }) =>
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) })));
    const unsub = onSnapshot(
      q,
      (snap) => { mapRows(snap); setLive(true); },
      (err) => {
        console.error('peaks-tab', err);
        setLive(false);
        void getDocs(q).then(mapRows);
      },
    );
    return unsub;
  }, []);

  const analysis = useMemo(() => {
    const now = Date.now();
    const cutoff = period > 0 ? now - period * 86400000 : 0;
    const scoped = rows.filter((s) => s.startedAt >= cutoff);

    const hourMin = new Array(24).fill(0) as number[];
    const dayMin = new Array(7).fill(0) as number[];
    const hourSeen = Array.from({ length: 24 }, () => new Set<string>());
    const daySeen = Array.from({ length: 7 }, () => new Set<string>());

    for (const s of scoped) {
      const start = s.startedAt;
      const end = s.endedAt
        ? Math.max(s.endedAt, start + 60000)
        : s.status === 'settled'
          ? Math.min(start + 60000, now)
          : now;
      if (end <= start) continue;
      let cur = start;
      let guard = 0;
      while (cur < end && guard < 200) {
        guard++;
        const d = new Date(cur);
        const hr = d.getHours();
        const wd = d.getDay();
        const nextHr = new Date(d);
        nextHr.setHours(hr + 1, 0, 0, 0);
        const seg = Math.min(nextHr.getTime(), end);
        const durMin = (seg - cur) / 60000;
        hourMin[hr] += durMin;
        dayMin[wd] += durMin;
        hourSeen[hr].add(s.id);
        daySeen[wd].add(s.id);
        cur = seg;
      }
    }

    const hours: HourRow[] = Array.from({ length: 24 }, (_, h) => ({ h, minutes: hourMin[h], sessions: hourSeen[h].size }));
    const days: DayRow[] = Array.from({ length: 7 }, (_, wd) => ({ wd, minutes: dayMin[wd], sessions: daySeen[wd].size }));
    const maxHour = hours.reduce((a, b) => (b.minutes > a.minutes ? b : a), hours[0]);
    const maxDay = days.reduce((a, b) => (b.minutes > a.minutes ? b : a), days[0]);
    const totalMinutes = hourMin.reduce((a, b) => a + b, 0);

    return { hours, days, maxHour, maxDay, totalSessions: scoped.length, totalMinutes };
  }, [rows, period]);

  return (
    <div className="admin-body">
      <section>
        <h4>⚡ أوقات الذروة — تحليل الازدحام</h4>
        <p className="device-hint">
          تقرير مستقل تماماً عن أي بيانات مالية: يُبنى فقط على سجلات الجلسات (الوقت البدء والانتهاء) مباشرة من
          قاعدة البيانات، ويوزّع دقائق تشغيل الأجهزة على الـ 24 ساعة وعلى أيام الأسبوع لتحديد أكثر الأوقات ازدحاماً.
        </p>
        <div className="chip-row">
          {PEAK_PERIODS.map((p) => (
            <button key={p.days} className={`chip ${period === p.days ? 'chip-on' : ''}`} onClick={() => setPeriod(p.days)}>
              {p.label}
            </button>
          ))}
          <span className="chip" style={{ background: 'transparent' }}>
            {live ? 'مزامنة مباشرة ✓' : 'غير متصل — آخر بيانات'}
          </span>
        </div>
        {analysis.totalSessions === 0 && <p className="device-hint">لا توجد جلسات مسجلة ضمن هذه الفترة بعد.</p>}
      </section>

      <section>
        <div className="stat-row four">
          <div className="stat"><span>الجلسات ضمن الفترة</span><strong>{analysis.totalSessions}</strong></div>
          <div className="stat"><span>إجمالي ساعات التشغيل</span><strong>{fmtMinutes(Math.round(analysis.totalMinutes))}</strong></div>
          <div className="stat accent"><span>أكثر ساعة ازدحاماً</span><strong>{hourLabel(analysis.maxHour.h)}</strong></div>
          <div className="stat accent"><span>أكثر يوم زحمة</span><strong>{DAY_NAMES_AR[analysis.maxDay.wd]}</strong></div>
        </div>
      </section>

      <section>
        <h4>التوزيع على الـ 24 ساعة</h4>
        <table className="tbl">
          <thead>
            <tr>
              <th>الساعة</th>
              <th className="bar-cell">النشاط النسبي</th>
              <th>دقائق التشغيل</th>
              <th>عدد الجلسات</th>
            </tr>
          </thead>
          <tbody>
            {analysis.hours.map((h) => (
              <tr key={h.h} className={h.h === analysis.maxHour.h ? 'peak-row' : ''}>
                <td>{hourLabel(h.h)} {h.h === analysis.maxHour.h && <span className="tag">القمة</span>}</td>
                <td className="cell-detail">
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${analysis.maxHour.minutes ? Math.max(2, (h.minutes / analysis.maxHour.minutes) * 100) : 0}%` }}
                    />
                  </div>
                </td>
                <td>{fmtMinutes(Math.round(h.minutes))}</td>
                <td>{h.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4>التوزيع على أيام الأسبوع (الأحد → السبت)</h4>
        <table className="tbl">
          <thead>
            <tr>
              <th>اليوم</th>
              <th className="bar-cell">النشاط النسبي</th>
              <th>دقائق التشغيل</th>
              <th>عدد الجلسات</th>
            </tr>
          </thead>
          <tbody>
            {analysis.days.map((d) => (
              <tr key={d.wd} className={d.wd === analysis.maxDay.wd ? 'peak-row' : ''}>
                <td>{DAY_NAMES_AR[d.wd]} {d.wd === analysis.maxDay.wd && <span className="tag">القمة</span>}</td>
                <td className="cell-detail">
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${analysis.maxDay.minutes ? Math.max(2, (d.minutes / analysis.maxDay.minutes) * 100) : 0}%` }}
                    />
                  </div>
                </td>
                <td>{fmtMinutes(Math.round(d.minutes))}</td>
                <td>{d.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/**
 * لوحة إدارة المستخدمين — متاحة للمدير فقط (هذه اللوحة جزء من لوحة الإدارة
 * المتاحة فقط لدور admin). تسمت بتحديث الاسم ورمز الدخول للحسابات الحالية،
 * وإضافة/تعديل/حذف حسابات مديرين أو موظفين جدد.
 */
function UsersTab() {
  const { users, addUser, updateUser, deleteUser } = useStore();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [err, setErr] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; type: 'ok' | 'err'; text: string } | null>(null);
  const [userToDelete, setUserToDelete] = useState<{ id: string; label: string } | null>(null);
  const toastSeq = useRef(0);

  // معرّف فريد لكل إشعار حتى يُعاد تركيبه وتُضبط مهلة الإخفاء من جديد عند تكرار الإشعار.
  const showToast = (type: 'ok' | 'err', text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, type, text });
  };

  const sorted = useMemo(
    () => [...users].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ar') : a.role === 'admin' ? -1 : 1)),
    [users],
  );

  const add = async () => {
    setErr('');
    try {
      await addUser(displayName, username, pin, role);
      setDisplayName(''); setUsername(''); setPin(''); setRole('staff');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل إضافة المستخدم');
    }
  };

  const handleAvatarUpload = (userId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('err', 'حجم الصورة يتجاوز 2 ميجابايت ✕');
      e.target.value = '';
      return;
    }
    setUploadingId(userId);
    // تحويل الصورة إلى Base64 (DataURL) عبر FileReader ثم حفظها مباشرة في avatarUrl بسجل المستخدم.
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      try {
        if (!dataUrl) throw new Error('صورة فارغة');
        updateUser(userId, { avatarUrl: dataUrl })
          .then(() => showToast('ok', 'تم رفع صورة البروفايل بنجاح ✓'))
          .catch(() => showToast('err', 'تعذر رفع الصورة، يرجى المحاولة مرة أخرى ✕'))
          .finally(() => setUploadingId(null));
      } catch {
        setUploadingId(null);
        showToast('err', 'تعذر رفع الصورة، يرجى المحاولة مرة أخرى ✕');
      }
    };
    reader.onerror = () => {
      setUploadingId(null);
      showToast('err', 'تعذر رفع الصورة، يرجى المحاولة مرة أخرى ✕');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="admin-body">
      <section>
        <h4>المستخدمون ({users.length})</h4>
        <table className="tbl">
          <thead>
            <tr><th>الصورة</th><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>رمز الدخول</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="user-avatar">
                    {u.avatarUrl ? <img src={u.avatarUrl} alt={`صورة ${u.displayName}`} /> : <span>{(u.displayName || '؟').charAt(0)}</span>}
                  </span>
                </td>
                <td>
                  <input
                    value={u.displayName}
                    onChange={(e) => void updateUser(u.id, { displayName: e.target.value }).catch((err) => alert(err.message))}
                  />
                </td>
                <td>
                  <input
                    value={u.username}
                    onChange={(e) => void updateUser(u.id, { username: e.target.value }).catch((err) => alert(err.message))}
                  />
                </td>
                <td>
                  <select
                    className="cat-select"
                    value={u.role}
                    onChange={(e) => void updateUser(u.id, { role: e.target.value as Role }).catch((err) => alert(err.message))}
                  >
                    <option value="admin">مدير (صلاحيات كاملة)</option>
                    <option value="staff">موظف (صلاحيات أساسية)</option>
                  </select>
                </td>
                <td>
                  <input
                    value={u.pin}
                    maxLength={6}
                    onChange={(e) => void updateUser(u.id, { pin: e.target.value.replace(/\D/g, '') }).catch((err) => alert(err.message))}
                  />
                </td>
                <td className="cell-actions">
                  <label className="btn tiny" style={{ cursor: uploadingId !== null ? 'not-allowed' : 'pointer', opacity: uploadingId === u.id ? 0.6 : 1 }}>
                    {uploadingId === u.id ? 'جارٍ…' : '🖼 صورة'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadingId !== null} onChange={(e) => void handleAvatarUpload(u.id, e)} />
                  </label>
                  <button
                    className="btn tiny danger-text"
                    onClick={() => setUserToDelete({ id: u.id, label: u.displayName })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="device-hint">لا يوجد مستخدمون بعد.</p>}
      </section>

      <section>
        <h4>إضافة مستخدم جديد</h4>
        <div className="rates-grid four">
          <div>
            <label className="field-label">الاسم</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="مثال: محمد علي" />
          </div>
          <div>
            <label className="field-label">اسم المستخدم</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mohamed" />
          </div>
          <div>
            <label className="field-label">رمز الدخول (4-6 أرقام)</label>
            <input value={pin} maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
          </div>
          <div>
            <label className="field-label">الصلاحية</label>
            <select className="cat-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="staff">موظف (مثل أحمد حسين)</option>
              <option value="admin">مدير (مثل أحمد الشريف)</option>
            </select>
          </div>
        </div>
        {err && <p className="modal-error">{err}</p>}
        <button className="btn primary" onClick={() => void add()}>+ إضافة مستخدم</button>
      </section>

      {userToDelete && (
        <ConfirmDialog
          title={`حذف المستخدم ${userToDelete.label}`}
          message={`هل أنت متأكد من حذف المستخدم "${userToDelete.label}" نهائياً؟ لن يتمكن من تسجيل الدخول بعد الآن.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteUser(userToDelete.id).catch((err) => alert(err.message)); setUserToDelete(null); }}
          onClose={() => setUserToDelete(null)}
        />
      )}

      {toast && (
        <Toast key={toast.id} type={toast.type} text={toast.text} onDone={() => setToast(null)} />
      )}
    </div>
  );
}

/**
 * تبويب «إدارة تنبيهات المباريات» — تحكم كامل بالمدير:
 * نافذة التنبيه المسبق (أسبوع/أسبوعان/3 أسابيع أو عدد مخصص من الأيام)، تفعيل التنبيهات الصوتية
 * وفاصل تكرارها المرن (مخصص بالدقائق/الساعات)، مفتاح API للمباريات التلقائية، ومباريات يدوية
 * تُحفظ فوراً في Firestore تحت `config.matches.manualMatches` (لا تختفي عند التحديث) مع رفع
 * صورة بنر محلياً كـ DataURL (بدون خادم — فوري ولا يتعطل). تدعم قراءة الاسم القديم customMatches.
 */
function MatchesTab() {
  const { config, updateConfig } = useStore();
  const ms = (config.matches ?? {}) as MatchSettings & { customMatches?: MatchEntry[] };
  const storedManual = ms.manualMatches && ms.manualMatches.length ? ms.manualMatches : ms.customMatches ?? [];

  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(MATCH_AUDIO_MASTER_KEY);
      if (raw !== null) return raw === '1';
    } catch {
      /* تجاهل */
    }
    return ms.audioEnabled ?? true;
  });
  const [intervalMin, setIntervalMin] = useState<number>(ms.alertIntervalMin ?? 30);
  const [customInterval, setCustomInterval] = useState(!(MATCH_ALERT_INTERVALS as readonly number[]).includes(ms.alertIntervalMin ?? 30));
  const [cusVal, setCusVal] = useState<number>(ms.alertIntervalMin ?? 30);
  const [cusUnit, setCusUnit] = useState<'min' | 'hr'>((ms.alertIntervalMin ?? 30) % 60 === 0 && (ms.alertIntervalMin ?? 30) >= 60 ? 'hr' : 'min');
  const [custom, setCustom] = useState<MatchEntry[]>(storedManual);

  const [streamDrafts, setStreamDrafts] = useState<Record<string, string>>({});
  const [streamSavingId, setStreamSavingId] = useState<string | null>(null);
  const [streamMsg, setStreamMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState('');

  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [league, setLeague] = useState('');
  const [mDate, setMDate] = useState('');
  const [mHour, setMHour] = useState('8');
  const [mMinute, setMMinute] = useState('00');
  const [mAmPm, setMAmPm] = useState<'AM' | 'PM'>('PM');
  const [domestic, setDomestic] = useState(true);
  const [homeLogo, setHomeLogo] = useState('');
  const [awayLogo, setAwayLogo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [voiceTestMsg, setVoiceTestMsg] = useState<string | null>(null);

  // عند أول فتح: إن لم يُحفظ المفتاح الرئيسي محلياً بعد، يُزرع من إعداد Firestore المتزامن.
  useEffect(() => {
    try {
      if (localStorage.getItem(MATCH_AUDIO_MASTER_KEY) === null) {
        setMatchAudioMaster(ms.audioEnabled ?? true);
      }
    } catch {
      /* تجاهل */
    }
  }, [ms.audioEnabled]);

  const clampIntervalMin = () => Math.max(1, Math.min(1440, Math.round(intervalMin) || 30));

  const buildMatchesPatch = (manualMatches: MatchEntry[]): Partial<Config> => ({
    matches: {
      audioEnabled,
      alertIntervalMin: clampIntervalMin(),
      manualMatches,
      matchStreams: ms.matchStreams ?? {},
    },
  });

  const saveAll = async () => {
    setErr('');
    setSaved('');
    setBusy(true);
    try {
      await updateConfig(buildMatchesPatch(custom));
      setSaved('تم حفظ إعدادات تنبيهات المباريات بنجاح');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل الحفظ');
    }
    setBusy(false);
  };

  /** يفتح سياق الصوت (يُطلق تصريح التشغيل التلقائي في Edge/Chrome) ويُنطق جملة تجريبية. */
  const testVoice = () => {
    setErr('');
    setVoiceTestMsg(null);
    unlockAudio();
    speakAr('اختبار الصوت. التنبيهات الصوتية للمباريات تعمل الآن.');
    setVoiceTestMsg('تم إطلاق التصريح الصوتي — اسمع السماعة الآن');
  };

  /** يحفظ قائمة المباريات اليدوية في Firestore فورياً (manualMatches) — لا تختفي عند التحديث. */
  const persistManual = async (next: MatchEntry[]) => {
    setCustom(next);
    setErr('');
    setSaved('');
    setBusy(true);
    try {
      await updateConfig(buildMatchesPatch(next));
      setSaved('تم حفظ المباريات اليدوية بنجاح');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل حفظ المباريات اليدوية');
    }
    setBusy(false);
  };

  const resetForm = () => {
    const p = (n: number) => String(n).padStart(2, '0');
    const d = new Date(Date.now() + 86400000);
    setHome(''); setAway(''); setLeague('');
    setMDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    setMHour('8'); setMMinute('00'); setMAmPm('PM');
    setDomestic(true); setHomeLogo(''); setAwayLogo(''); setEditingId(null); setErr('');
  };

  const editMatch = (m: MatchEntry) => {
    setEditingId(m.id);
    setHome(m.homeTeam); setAway(m.awayTeam); setLeague(m.league);
    const d = new Date(m.startTime);
    const p = (n: number) => String(n).padStart(2, '0');
    setMDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    const h24 = d.getHours();
    setMAmPm(h24 >= 12 ? 'PM' : 'AM');
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setMHour(String(h12));
    setMMinute(p(d.getMinutes()));
    setDomestic(m.domestic); setHomeLogo(m.homeLogo ?? ''); setAwayLogo(m.awayLogo ?? '');
    setErr('');
  };

  const updateMatch = () => {
    if (!home.trim() || !away.trim()) { setErr('أدخل اسمي الفريقين أولاً'); return; }
    if (!league.trim()) { setErr('أدخل اسم البطولة'); return; }
    const h24raw = (Number(mHour) % 12) + (mAmPm === 'PM' ? 12 : 0);
    const h24 = Number.isFinite(h24raw) ? h24raw : 12;
    const mins = Math.min(59, Math.max(0, Number(mMinute) || 0));
    const start = mDate
      ? new Date(`${mDate}T${String(h24).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`).getTime()
      : Date.now() + 86400000;
    if (!Number.isFinite(start)) { setErr('موعد المباراة غير صحيح'); return; }
    const existing = editingId ? custom.find((x) => x.id === editingId) : undefined;
    const entry: MatchEntry = {
      id: editingId ?? `manual-${Date.now()}`,
      homeTeam: home.trim(),
      awayTeam: away.trim(),
      league: league.trim(),
      startTime: start,
      domestic,
      homeLogo: homeLogo || undefined,
      awayLogo: awayLogo || undefined,
      source: 'manual',
      streamUrl: existing?.streamUrl,
    };
    const next = editingId ? custom.map((x) => (x.id === editingId ? entry : x)) : [...custom, entry];
    void persistManual(next);
    resetForm();
  };

  const deleteMatch = (id: string) => {
    void persistManual(custom.filter((x) => x.id !== id));
  };

  /** رابط البث المحفوظ فعلياً لأي مباراة (بدون تعديلات جارية) — لشارة «يوجد بث فعال». */
  const savedStreamOf = (m: MatchEntry): string =>
    (ms.matchStreams?.[m.id] ?? m.streamUrl ?? '').trim();

  /** رابط البث الحالي للعرض في حقل الإدخال: يُفضَّل التعديل الجاري، ثم المحفوظ. */
  const streamUrlOf = (m: MatchEntry): string =>
    streamDrafts[m.id] ?? savedStreamOf(m);

  /**
   * حفظ/مسح رابط البث لمباراة يدوية محددة مباشرةً في خريطة matchStreams بمفتاح
   * معرّف المباراة نفسه — فيبقى كل رابط مقروناً بمباراةٍ بعينها (كارط أ) ولا يتبدل بين البطاقات،
   * ويُدمج تلقائياً في `effectiveMatches` ثم يقرؤه MatchPopup بمعرّف المباراة الجاري عرضه.
   * القيمة الفارغة (زر «حذف الرابط») تحذف الإدخال من الخريطة.
   */
  const saveStreamUrl = async (m: MatchEntry, forcedValue?: string) => {
    const value = (forcedValue ?? streamUrlOf(m)).trim();
    const map = { ...(ms.matchStreams ?? {}) };
    if (value) map[m.id] = value; else delete map[m.id];
    setErr('');
    setSaved('');
    setStreamMsg(null);
    setBusy(true);
    setStreamSavingId(m.id);
    try {
      await updateConfig({
        matches: {
          audioEnabled,
          alertIntervalMin: clampIntervalMin(),
          manualMatches: custom,
          matchStreams: map,
        },
      });
      setStreamDrafts((d) => ({ ...d, [m.id]: value }));
      setStreamMsg({ ok: true, text: `حُفظ رابط البث لمباراة ${m.homeTeam} ضد ${m.awayTeam}` });
    } catch (e) {
      setStreamMsg({ ok: false, text: e instanceof Error ? e.message : 'فشل حفظ رابط البث' });
    }
    setBusy(false);
    setStreamSavingId(null);
  };

  /** تحويل فوري لشعار الفريق محلياً إلى Base64 DataURL عبر FileReader — بلا أي رفع شبكي أو تعليق. */
  const pickLogo = async (file: File | undefined, apply: (url: string) => void) => {
    if (!file) return;
    setErr('');
    try {
      const url = await fileToDataUrl(file, 240, 0.9);
      apply(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل معالجة الصورة');
    }
  };

  const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  const sorted = [...custom].sort((a, b) => a.startTime - b.startTime);

  // قائمة موحّدة لكل المباريات اليدوية (مصدر قائمة الاختيار لربط روابط البث).
  const matchOptions = useMemo(
    () => [...custom].sort((a, b) => a.startTime - b.startTime),
    [custom],
  );

  // بحث بسيط داخل القائمة (عند تجاوز حد العدد): يفلتر حسب أسماء الفريقين والبطولة.
  const filteredOptions = matchSearch.trim()
    ? matchOptions.filter((m) =>
      `${m.homeTeam} ${m.awayTeam} ${m.league}`.toLowerCase().includes(matchSearch.trim().toLowerCase()))
    : matchOptions;

  // المباراة المحددة حالياً في القائمة المنسدلة (تُعاد تعيينها إن اختفت بعد تحديث تلقائي).
  const selectedMatch = matchOptions.find((m) => m.id === selectedMatchId) ?? null;

  return (
    <div className="admin-body">
      <section>
        <h4>🔔 التنبيهات الصوتية للمباريات</h4>

        <div className="setting-row">
          <div>
            <strong>🔊 التنبيهات الصوتية للمباريات</strong>
            <p className="device-hint">المفتاح الرئيسي لكامل التطبيق: إطفاؤه يعطّل كل التنبيهات الصوتية للمباريات فوراً. نطق «غداً» أو «اليوم» لمباريات الفرق الكبرى (قبل يوم / يوم المباراة).</p>
            {voiceTestMsg && <p className="device-hint" style={{ color: 'var(--green)' }}>{voiceTestMsg}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn ghost" onClick={testVoice}>تجربة الصوت 🔊</button>
            <button
              type="button"
              className={`switch ${audioEnabled ? 'on' : ''}`}
              role="switch"
              aria-checked={audioEnabled}
              onClick={() => {
                const next = !audioEnabled;
                setAudioEnabled(next);
                setMatchAudioMaster(next);
              }}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>

        <div className="rates-grid four">
          <div>
            <label className="field-label">فاصل تكرار التنبيه الصوتي</label>
            <select
              className="cat-select"
              value={customInterval ? 'custom' : intervalMin}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom') { setCustomInterval(true); return; }
                const m = Number(v);
                setCustomInterval(false);
                setIntervalMin(m);
                setCusVal(m);
                setCusUnit(m % 60 === 0 && m >= 60 ? 'hr' : 'min');
              }}
            >
              {MATCH_ALERT_INTERVALS.map((m) => (
                <option key={m} value={m}>{m >= 60 ? `${m / 60} ساعة` : `${m} دقيقة`}</option>
              ))}
              <option value="custom">مخصص (أدخل القيمة…)</option>
            </select>
          </div>
          {customInterval && (
            <div>
              <label className="field-label">القيمة المخصصة</label>
              <div className="time-picker">
                <input
                  type="number"
                  min={1}
                  max={cusUnit === 'hr' ? 24 : 240}
                  value={cusVal}
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value) || 0);
                    setCusVal(n);
                    setIntervalMin(cusUnit === 'hr' ? n * 60 : n);
                  }}
                  dir="ltr"
                />
                <select
                  className="cat-select"
                  value={cusUnit}
                  onChange={(e) => {
                    const u = e.target.value as 'min' | 'hr';
                    if (u === 'hr') {
                      const hours = Math.max(1, Math.round(cusVal / 60));
                      setCusVal(hours);
                      setIntervalMin(hours * 60);
                    } else {
                      const mins = Math.max(1, cusVal * 60);
                      setCusVal(mins);
                      setIntervalMin(mins);
                    }
                    setCusUnit(u);
                  }}
                >
                  <option value="min">دقيقة</option>
                  <option value="hr">ساعة</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {err && <p className="modal-error">{err}</p>}
        {saved && <p className="modal-error" style={{ color: 'var(--green)' }}>{saved}</p>}
        {streamMsg && (
          <p className="modal-error" style={{ color: streamMsg.ok ? 'var(--green)' : 'var(--amber)' }}>{streamMsg.text}</p>
        )}
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" disabled={busy} onClick={() => void saveAll()}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
          </button>
        </div>
      </section>

      <section>
        <h4>🎬 إدارة روابط البث المباشر</h4>
        <p className="device-hint">اختر مباراة من القائمة لربط رابط بث خاص بها — كل مباراة تحتفظ برابطها بمعرّفها الخاص وتُفتح به من نافذة المباريات. البث يُوجَّه تلقائياً عبر الوكيل المدمج /iptv-stream داخل التطبيق نفسه.</p>
        {matchOptions.length > 10 && (
          <input
            className="stream-search"
            value={matchSearch}
            onChange={(e) => setMatchSearch(e.target.value)}
            placeholder="ابحث عن فريق أو بطولة…"
            dir="rtl"
          />
        )}
        <select
          className="cat-select stream-select"
          value={selectedMatchId ?? ''}
          onChange={(e) => setSelectedMatchId(e.target.value || null)}
        >
          <option value="">اختر المباراة لإضافة رابط البث</option>
          {filteredOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.homeTeam} ضد {m.awayTeam} - {fmtClock(m.startTime)}</option>
          ))}
        </select>

        {selectedMatch ? (
          <div className="stream-card">
            <div className="stream-card-head">
              <div className="stream-card-main">
                <strong className="stream-card-title">{selectedMatch.homeTeam} ضد {selectedMatch.awayTeam}</strong>
                <span className="stream-card-meta">🏆 {selectedMatch.league}</span>
                <span className="stream-card-meta">🕐 {fmtDateTimeFull(selectedMatch.startTime)}</span>
              </div>
              <span className={`stream-card-badge ${savedStreamOf(selectedMatch) ? 'on' : ''}`}>
                {savedStreamOf(selectedMatch) ? '🟢 يوجد بث فعال' : '⚪ لا يوجد بث'}
              </span>
            </div>
            <div className="stream-card-body">
              <input
                className="stream-card-url"
                value={streamUrlOf(selectedMatch)}
                onChange={(e) => setStreamDrafts((d) => ({ ...d, [selectedMatch.id]: e.target.value }))}
                placeholder="https://… أو  ….m3u8 / .ts"
                dir="ltr"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && streamUrlOf(selectedMatch).trim()) void saveStreamUrl(selectedMatch);
                }}
              />
              <div className="stream-card-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || streamSavingId === selectedMatch.id || !streamUrlOf(selectedMatch).trim()}
                  onClick={() => void saveStreamUrl(selectedMatch)}
                >
                  {streamSavingId === selectedMatch.id ? 'جارٍ الحفظ…' : 'حفظ الرابط'}
                </button>
                <button
                  type="button"
                  className="btn ghost danger-text"
                  disabled={busy || streamSavingId === selectedMatch.id || !savedStreamOf(selectedMatch)}
                  onClick={() => void saveStreamUrl(selectedMatch, '')}
                >
                  حذف الرابط
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="device-hint">لا توجد مباراة محددة بعد — اختر من القائمة أعلاه.</p>
        )}
      </section>

      <section>
        <h4>⚽ مباريات يدوية (تُحفظ فوراً ولا تختفي عند التحديث)</h4>
        <div className="rates-grid four">
          <div><label className="field-label">الفريق الأول</label><input value={home} onChange={(e) => setHome(e.target.value)} placeholder="الأهلي" /></div>
          <div><label className="field-label">الفريق الثاني</label><input value={away} onChange={(e) => setAway(e.target.value)} placeholder="الزمالك" /></div>
          <div><label className="field-label">البطولة</label><input value={league} onChange={(e) => setLeague(e.target.value)} placeholder="الدوري المصري الممتاز" /></div>
          <div>
            <label className="field-label">التاريخ</label>
            <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="field-label">موعد المباراة (ساعة / دقيقة / صباحاً-مساءً)</label>
            <div className="time-picker">
              <select className="cat-select" value={mHour} onChange={(e) => setMHour(e.target.value)} aria-label="الساعة">
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <select className="cat-select" value={mMinute} onChange={(e) => setMMinute(e.target.value)} aria-label="الدقيقة">
                {MINUTES.map((mn) => <option key={mn} value={mn}>{mn}</option>)}
              </select>
              <select className="cat-select" value={mAmPm} onChange={(e) => setMAmPm(e.target.value as 'AM' | 'PM')}>
                <option value="AM">صباحاً (AM)</option>
                <option value="PM">مساءً (PM)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">التصنيف</label>
            <select className="cat-select" value={domestic ? 'domestic' : 'global'} onChange={(e) => setDomestic(e.target.value === 'domestic')}>
              <option value="domestic">محلية (OnTime Sports)</option>
              <option value="global">عالمية (beIN Sports)</option>
            </select>
          </div>
          <div>
            <label className="field-label">شعار الفريق الأول</label>
            <input type="file" accept="image/*" onChange={(e) => void pickLogo(e.target.files?.[0], setHomeLogo)} />
            <p className="device-hint">يُحوَّل لـ Base64 فوراً على الجهاز (FileReader) بلا رفع أو انتظار شبكة.</p>
            {homeLogo && <img src={homeLogo} alt="معاينة" className="mb-preview" />}
          </div>
          <div>
            <label className="field-label">شعار الفريق الثاني</label>
            <input type="file" accept="image/*" onChange={(e) => void pickLogo(e.target.files?.[0], setAwayLogo)} />
            <p className="device-hint">يُحوَّل لـ Base64 فوراً على الجهاز (FileReader) بلا رفع أو انتظار شبكة.</p>
            {awayLogo && <img src={awayLogo} alt="معاينة" className="mb-preview" />}
          </div>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" disabled={busy} onClick={updateMatch}>{editingId ? 'تحديث المباراة' : '+ إضافة مباراة'}</button>
          {editingId && <button className="btn ghost" onClick={resetForm}>إلغاء التعديل</button>}
        </div>

        {sorted.length > 0 && (
          <table className="tbl">
            <thead><tr><th>المباراة</th><th>البطولة</th><th>الموعد</th><th>القناة</th><th>الشعارات</th><th></th></tr></thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.homeTeam}</strong> ضد <strong>{m.awayTeam}</strong></td>
                  <td>{m.league}</td>
                  <td>{fmtDateTimeFull(m.startTime)}</td>
                  <td>{m.domestic ? 'OnTime Sports' : 'beIN Sports'}</td>
                  <td className="cell-detail">{(m.homeLogo || m.awayLogo) ? '✓ شعارات' : '—'}</td>
                  <td className="cell-actions">
                    <button className="btn tiny" disabled={busy} onClick={() => editMatch(m)}>تعديل</button>
                    <button className="btn tiny danger-text" disabled={busy} onClick={() => deleteMatch(m.id)}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sorted.length === 0 && <p className="device-hint">لا توجد مباريات يدوية — أضف أول مباراة أعلاه.</p>}
      </section>

      <TournamentManager />
    </div>
  );
}

const GROUP_COUNT_OPTIONS = [2, 4, 6];

const STAGE_LABEL: Record<TournamentStage, string> = {
  pending: 'في انتظار القرعة',
  groups: 'جارية',
  playoff: 'جارية',
  done: 'منتهية',
};

/** حالة القرعة أثناء الظهور التدريجي — تُخزَّن محلياً ثم تُحفظ في Firestore عند اكتمال الظهور. */
interface DrawReveal {
  bracket: TournamentMatch[];
  groups: TournamentGroup[];
  stage: TournamentStage;
  format: TournamentFormat;
  total: number;
  revealed: number;
  /** ترتيب ظهور اللاعبين داخل مجموعاتهم (نظام المجموعات): يُكشف اسم لاعب واحد كل 2000ms. */
  playerOrder: { gId: string; player: string }[];
  /** ترتيب ظهور مباريات المجموعات بعد اكتمال توزيع اللاعبين: يُكشف الطرف أولاً ثم خصمه ثانياً (2000ms بينهما) لكل مباراة. */
  matchOrder: { gId: string; matchId: string; side: 'A' | 'B' }[];
}

/** حالة قرعة حسم التكافؤ داخل مجموعة — تُكشف أسماء المتعادلين واحداً واحداً (2000ms) ثم تُحفظ القرعة. */
interface TieReveal {
  groupId: string;
  /** ترتيب السحب العشوائي للمتعادلين (أول اسم يُسحب يصبح الأعلى ترتيباً). */
  order: string[];
  revealed: number;
  total: number;
}

/** حالة مصباح الحالة الديناميكي (LED): أصفر نابض أثناء القرعة، أخضر متوهّج أثناء الجولات، أحمر عند الانتهاء. */
type LedState = 'yellow' | 'green' | 'red' | 'off';

function ledStateFor(stage: TournamentStage, reveal: DrawReveal | null, tieReveal: TieReveal | null): LedState {
  if (reveal || tieReveal) return 'yellow';
  if (stage === 'done') return 'red';
  if (stage === 'pending') return 'off';
  return 'green';
}

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  knockout: 'خروج المغلوب المباشر',
  groups: 'نظام المجموعات',
};

/**
 * وحدة إدارة بطولات البلايستيشن داخل تبويب «إدارة المباريات والتنبيهات»:
 * - إنشاء الدورة: الاسم + قائمة المشتركين الديناميكية (إضافة/حذف واستعراض الإجمالي) + نظام اللعب
 *   (خروج المغلوب المباشر / نظام المجموعات بصعود أول مركزين).
 * - قرعة عشوائية تلقائية (خلط Fisher–Yates) تقوم بتوزيع المواجهات أو المجموعات فوراً.
 * - شجرة إقصاء تفاعلية بجولاتها (دور الـ16 ← ربع النهائي ← نصف النهائي ← النهائي) أو جداول مجموعات
 *   (لعب/فاز/تعادل/خسر/له/عليه/الفرق/النقاط) مع إدخال نتائج وتقدم تلقائي للفائز إلى عقدة الشجرة التالية.
 * - كل دورة بكل تقدمها تُحفظ بموجب signing في Firestore وتُستأنف/تُحذف في أي وقت عبر الاشتراك اللحظي.
 */
function TournamentManager() {
  const { tournaments, createTournament, saveTournament, deleteTournament } = useStore();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('knockout');
  const [participantsText, setParticipantsText] = useState('');
  const [groupCount, setGroupCount] = useState(4);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Tournament | null>(null);
  const [reveal, setReveal] = useState<DrawReveal | null>(null);
  const [tieReveal, setTieReveal] = useState<TieReveal | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const tieRevealTimerRef = useRef<number | null>(null);
  const pendingDrawRef = useRef<{ bracket: TournamentMatch[]; groups: TournamentGroup[]; stage: TournamentStage } | null>(null);

  const active = tournaments.find((t) => t.id === selectedTournamentId) ?? null;
  const formPlayers = participantsText.split('\n').map((s) => s.trim()).filter(Boolean);
  const ledState = ledStateFor(active?.stage ?? 'pending', reveal, tieReveal);

  // إيقاف أي مؤقّت قرعة متبقٍ عند مغادرة المكوّن (تفادي تسريبات المحوّلات).
  useEffect(() => () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    if (tieRevealTimerRef.current !== null) window.clearTimeout(tieRevealTimerRef.current);
  }, []);

  const clearMsgs = () => { setErr(''); setNotice(''); };

  const create = async () => {
    clearMsgs();
    if (!name.trim()) { setErr('أدخل اسم الدورة أولاً'); return; }
    if (formPlayers.length < 2) { setErr('أضف مشتركين اثنين على الأقل (اسم في كل سطر)'); return; }
    try {
      const id = await createTournament(name, format, formPlayers);
      setName('');
      setParticipantsText('');
      setSelectedTournamentId(id);
      setNotice('تم إنشاء الدورة — عدّل المشتركين إن أردت ثم اضغط «عمل قرعة عشوائية»');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل إنشاء الدورة');
    }
  };

  const activeReal = useRef<Tournament | null>(active);
  activeReal.current = active;

  const startReveal = (target: { bracket: TournamentMatch[]; groups: TournamentGroup[]; stage: TournamentStage; format: TournamentFormat }) => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    pendingDrawRef.current = target;

    let total = 0;
    let playerOrder: { gId: string; player: string }[] = [];
    let matchOrder: { gId: string; matchId: string; side: 'A' | 'B' }[] = [];

    if (target.bracket.length > 0) {
      // خروج المغلوب مباشر أو مرحلة الإقصاء بعد المجموعات: كل اسم لاعب مقعد مستقل (A ثم B لكل مباراة)
      // بفاصل 2000ms — المجموعات تبقى ظاهرة كخلفية ثابتة أثناء كشف مقاعد الشجرة.
      total = Math.max(1, drawRevealSlots(target.bracket, []).length);
    } else {
      // نظام المجموعات: الحاويات الفارغة أولاً → اللاعبون واحداً واحداً (2000ms) → مباريات كل مقعد على حدة
      // (الطرف أولاً، ثم خصمه بعد 2000ms، ثم المباراة التالية بعد 2000ms أخرى).
      for (const g of target.groups) {
        for (const p of g.players) playerOrder.push({ gId: g.id, player: p });
        for (const m of g.matches) {
          matchOrder.push({ gId: g.id, matchId: m.id, side: 'A' });
          matchOrder.push({ gId: g.id, matchId: m.id, side: 'B' });
        }
      }
      total = 1 + playerOrder.length + matchOrder.length;
    }

    // نُكتب خطة القرعة (مصدر وقت موحّد + عدد المقاعد) إلى Firestore في لحظة البدء، فيقرأها
    // كل متصفح/لوحة على ساعته المحلية بنفس إيقاع 2000ms — فيدخل الجميع في وضع الظهور معاً.
    const kind: 'draw' | 'playoff' | 'tie' = target.bracket.length > 0 && target.groups.length > 0 ? 'playoff' : 'draw';
    const startedAt = Date.now();
    const ref0 = activeReal.current;
    if (ref0) {
      void saveTournament({
        ...ref0,
        bracket: target.bracket,
        groups: target.groups,
        stage: target.stage,
        reveal: { kind, startedAt, total, playerOrder, matchOrder },
      });
    }

    setReveal({ ...target, total, revealed: 0, playerOrder, matchOrder });
    setNotice('جاري سحب القرعة…');
    const step = (n: number) => {
      if (n >= total) {
        // اكتمل الظهور التدريجي — الآن نُنهي القرعة ونزيل خطة القرعة من الدورة (تبقى النتائج النهائية فقط).
        const payload = pendingDrawRef.current;
        const ref = activeReal.current;
        if (payload && ref) {
          void saveTournament({ ...ref, bracket: payload.bracket, groups: payload.groups, stage: payload.stage, reveal: undefined });
        }
        const isPlayoffBuild = payload?.stage === 'playoff' && (payload?.bracket ?? []).length > 0 && (payload?.groups ?? []).length > 0;
        setReveal(null);
        pendingDrawRef.current = null;
        setNotice(isPlayoffBuild ? 'تم بناء مرحلة الإقصاء — صعود أول مركزين من كل مجموعة' : 'تم إجراء القرعة العشوائية بنجاح');
        setSelectedTournamentId(ref?.id ?? '');
        return;
      }
      setReveal((r) => (r ? { ...r, revealed: n + 1 } : r));
      revealTimerRef.current = window.setTimeout(() => step(n + 1), 2000);
    };
    revealTimerRef.current = window.setTimeout(() => step(0), 500);
  };

  /** قرعة حسم تكافؤ داخل مجموعة: نسحب المتعادلين عشوائياً ثم نكشف أسماءهم واحداً واحداً (2000ms)
   *  مع LED أصفر نابض، وبعد اكتمال الظهور تُحفظ القرعة في Firestore (عبر saveTournament). */
  const startTieReveal = (g: TournamentGroup) => {
    if (!active || tieRevealTimerRef.current !== null || !!reveal) return;
    clearMsgs();
    const tied = findQualificationTie(g);
    if (!tied || tied.length < 2) return;
    const order = shuffle(tied);
    const total = order.length;

    // نكتب خطة قرعة الحسم (ترتيب السحب + عدد الأسماء) إلى Firestore مع مصدر وقت موحّد،
    // فتظهر على كل الشاشات لحظياً بنفس إيقاع 2000ms بين الاسم والآخر مع LED أصفر نابض.
    const startedAt = Date.now();
    const ref0 = activeReal.current;
    if (ref0) {
      void saveTournament({
        ...ref0,
        reveal: { kind: 'tie', startedAt, total, playerOrder: [], matchOrder: [], tie: { groupId: g.id, order } },
      });
    }

    setTieReveal({ groupId: g.id, order, revealed: 0, total });
    setNotice('جاري قرعة حسم المتأهلين…');
    const step = (n: number) => {
      if (n >= total) {
        // اكتمل السحب: نثبّت الترتيب المسحوب كقرعة حسم ونحفظه نهائياً (مع إزالة خطة القرعة).
        const draft = activeReal.current;
        if (draft) {
          const groups = draft.groups.map((gg) => gg.id === g.id ? applyTiebreak(gg, order) : gg);
          void saveTournament({ ...draft, groups, reveal: undefined });
          setNotice('تم حسم التعادل بالقرعة — ترتيب المتأهلين مُحدَّث');
        } else {
          setNotice('تم حسم التعادل بالقرعة');
        }
        setTieReveal(null);
        tieRevealTimerRef.current = null;
        return;
      }
      setTieReveal((r) => (r ? { ...r, revealed: n + 1 } : r));
      tieRevealTimerRef.current = window.setTimeout(() => step(n + 1), 2000);
    };
    tieRevealTimerRef.current = window.setTimeout(() => step(0), 500);
  };

  const doDraw = () => {
    if (!active) return;
    clearMsgs();
    try {
      if (active.format === 'knockout') {
        const bracket = buildKnockoutBracket(shuffle(active.participants));
        startReveal({ format: 'knockout', bracket, groups: [], stage: 'playoff' });
      } else {
        if (active.participants.length < groupCount * 2) {
          setErr(`عدد المشتركين (${active.participants.length}) لا يكفي لـ ${groupCount} مجموعات — يلزم ${groupCount * 2} على الأقل (مشتركان في كل مجموعة)`);
          return;
        }
        const groups = buildGroups(active.participants, groupCount);
        startReveal({ format: 'groups', bracket: [], groups, stage: 'groups' });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل القرعة');
    }
  };

  const addPlayer = () => {
    if (!active) return;
    const p = newPlayer.trim();
    clearMsgs();
    if (!p) return;
    if (active.participants.some((x) => x === p)) { setErr('هذا الاسم موجود مسبقاً'); return; }
    void saveTournament({ ...active, participants: [...active.participants, p] });
    setNewPlayer('');
  };

  const removePlayer = (p: string) => {
    if (!active) return;
    clearMsgs();
    if (active.participants.length <= 2) { setErr('يجب بقاء مشتركين اثنين على الأقل'); return; }
    void saveTournament({ ...active, participants: active.participants.filter((x) => x !== p) });
  };

  const setKnockoutScore = (t: Tournament, m: TournamentMatch, side: 'A' | 'B', raw: string) => {
    const num = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw) || 0));
    const a = side === 'A' ? num : m.scoreA;
    const b = side === 'B' ? num : m.scoreB;
    const bracket = applyKnockoutResult(t.bracket, m.id, a, b);
    void saveTournament({ ...t, bracket, stage: knockoutStageOf(bracket) });
  };

  const setGroupScore = (t: Tournament, g: TournamentGroup, m: TournamentMatch, side: 'A' | 'B', raw: string) => {
    const num = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw) || 0));
    const groups = t.groups.map((gg) => gg.id === g.id
      ? { ...gg, matches: gg.matches.map((mm) => mm.id === m.id
          ? { ...mm, scoreA: side === 'A' ? num : mm.scoreA, scoreB: side === 'B' ? num : mm.scoreB }
          : mm) }
      : gg);
    void saveTournament({ ...t, groups });
  };

  /** تعيين/مسح رابط البث المباشر لمباراة (شجرة أو مجموعة) وحفظه في Firestore. الرابط الفارغ يُحذف الحقل. */
  const buildPlayoff = () => {
    if (!active) return;
    clearMsgs();
    if (!allGroupMatchesDone(active.groups)) { setErr('أكمل كل نتائج مباريات دور المجموعات أولاً'); return; }
    const list = buildPlayoffList(active.groups);
    if (list.length < 2) { setErr('لا يمكن بناء مرحلة الإقصاء — عدد الصاعدين غير كافٍ'); return; }
    const bracket = buildKnockoutBracket(list);
    // نُمرّر المجموعات أيضاً حتى تبقى جداولها ظاهرة أثناء كشف مقاعد الشجرة واحداً واحداً،
    // ثم تُحفظ الحالة (بما فيها الشجرة الجديدة) عند اكتمال الظهور في نهاية startReveal.
    startReveal({ format: 'groups', bracket, groups: active.groups, stage: 'playoff' });
    setNotice('جاري بناء مرحلة الإقصاء…');
  };

  const displayBracket = reveal ? reveal.bracket : (active?.bracket ?? []);
  const displayGroups = reveal ? reveal.groups : (active?.groups ?? []);
  const displayStage = reveal ? reveal.stage : (active?.stage ?? 'pending');
  const displayFormat = active?.format ?? 'knockout';
  const rounds = displayBracket.length ? [...new Set(displayBracket.map((m) => m.round))].sort((a, b) => a - b) : [];

  // أثناء السحب التدريجي يُكشف كل اسم لاعب (مقعد) تباعاً بفاصل 2000ms — الخريطة تربط كل مقعد بترتيب ظهوره.
  const revealSlotOrder = useMemo(() => {
    const map = new Map<string, number>();
    if (reveal) {
      drawRevealSlots(reveal.bracket, reveal.groups).forEach((key, i) => map.set(key, i));
    }
    return map;
  }, [reveal]);
  const revealedCount = reveal?.revealed ?? Infinity;
  // هل ظهر المقعد (A أو B) في مباراة معينة؟ (خروج المغلوب)
  const isSlotRevealed = (id: string, side: 'A' | 'B'): boolean => {
    if (!reveal) return true;
    const idx = revealSlotOrder.get(`${id}:${side}`);
    return idx === undefined ? false : idx < revealedCount;
  };

  // خرائط ترتيب الظهور لنظام المجموعات: اللاعبون ثم مباريات كل مجموعة.
  const revealPlayerIndex = useMemo(() => {
    const map = new Map<string, number>();
    (reveal?.playerOrder ?? []).forEach((s, i) => map.set(`${s.gId}:${s.player}`, i));
    return map;
  }, [reveal]);
  const revealMatchIndex = useMemo(() => {
    const map = new Map<string, number>();
    (reveal?.matchOrder ?? []).forEach((s, i) => map.set(`${s.gId}:${s.matchId}:${s.side}`, i));
    return map;
  }, [reveal]);
  // المراحل: 1) الحاويات الفارغة عند revealed>=1، 2) اللاعبون واحداً واحداً، 3) مقاعد المباريات
  // (كل مقعد A ثم B على حدة — كل اسم خصم يُكشف بعد 2000ms).
  // عند كشف شجرة (قرعة مباشرة أو مرحلة إقصاء بعد المجموعات) تبقى جداول المجموعات ظاهرة كاملة باستمرار.
  const bracketOnlyReveal = !!reveal && reveal.bracket.length > 0 && reveal.playerOrder.length === 0;
  const containersShown = !reveal || bracketOnlyReveal || revealedCount >= 1;
  const isPlayerRevealed = (gId: string, player: string): boolean => {
    if (!reveal || bracketOnlyReveal) return true;
    const idx = revealPlayerIndex.get(`${gId}:${player}`);
    return idx === undefined ? false : idx < revealedCount - 1;
  };
  const isMatchSlotRevealed = (gId: string, matchId: string, side: 'A' | 'B'): boolean => {
    if (!reveal || bracketOnlyReveal) return true;
    const idx = revealMatchIndex.get(`${gId}:${matchId}:${side}`);
    if (idx === undefined) return false;
    const base = 1 + (reveal?.playerOrder.length ?? 0);
    return idx < revealedCount - base;
  };

  return (
    <section>
      <h4>🎮 بطولات البلايستيشن</h4>
      <p className="device-hint">
        إنشاء بطولة كاملة: اسم الدورة، قائمة المشتركين الديناميكية، ونظام «خروج المغلوب المباشر»
        (شجرة: دور الـ16 ← ربع النهائي ← نصف النهائي ← النهائي) أو «نظام المجموعات»
        (صعود أول مركزين من كل مجموعة إلى مرحلة الإقصاء). قرعة عشوائية تلقائية + إدخال النتائج مباشرة،
        وكل دورة بحالتها تُحفظ في Firestore وتُستأنف من أي جهاز في أي وقت.
      </p>

      {err && <p className="modal-error">{err}</p>}
      {notice && <p className="modal-error" style={{ color: 'var(--green)' }}>{notice}</p>}

      <div className="rates-grid four">
        <div>
          <label className="field-label">اسم الدورة</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: دوري FIFA الرمضاني" />
        </div>
        <div>
          <label className="field-label">طريقة اللعب</label>
          <select className="cat-select" value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            <option value="knockout">خروج المغلوب المباشر (Single Elimination)</option>
            <option value="groups">نظام المجموعات (Groups)</option>
          </select>
        </div>
        <div>
          <label className="field-label">عدد المجموعات</label>
          <select className="cat-select" value={groupCount} onChange={(e) => setGroupCount(Math.max(2, Number(e.target.value) || 4))} disabled={format !== 'groups'}>
            {GROUP_COUNT_OPTIONS.map((c) => <option key={c} value={c}>{c} مجموعات</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label className="field-label">المشتركون — اسم واحد في كل سطر (الإجمالي الحالي: {formPlayers.length})</label>
        <textarea
          className="tournament-players"
          rows={4}
          value={participantsText}
          onChange={(e) => setParticipantsText(e.target.value)}
          placeholder={'اسم المشترك الأول\nاسم المشترك الثاني\nاسم المشترك الثالث'}
        />
      </div>

      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary" onClick={() => void create()}>+ إنشاء الدورة</button>
      </div>

      <h5>الدورات المحفوظة ({tournaments.length})</h5>
      {tournaments.length > 0 ? (
        <table className="tbl">
          <thead><tr><th>اسم الدورة</th><th>النظام</th><th>المشتركون</th><th>المرحلة</th><th>تاريخ الإنشاء</th><th></th></tr></thead>
          <tbody>
            {tournaments.map((t) => (
                <tr key={t.id} className={t.id === selectedTournamentId ? 'row-active' : undefined}>
                  <td>{t.id === selectedTournamentId ? '📂' : '🏆'}</td>
                  <td><strong>{t.name}</strong> <span className="media-chip">{t.participants.length} مشترك</span></td>
                  <td>{FORMAT_LABEL[t.format]}</td>
                  <td><span className={`stage-chip ${t.stage === 'done' ? 'stage-chip-done' : t.stage === 'pending' ? 'stage-chip-pending' : 'stage-chip-active'}`}>{STAGE_LABEL[t.stage]}</span></td>
                  <td>{fmtDateTimeFull(t.createdAt)}</td>
                  <td className="cell-actions">
                    <button
                      className="btn tiny"
                      onClick={() => { setSelectedTournamentId(t.id === selectedTournamentId ? null : t.id); clearMsgs(); }}
                    >
                      {t.id === selectedTournamentId ? 'إغلاق' : 'فتح البطولة'}
                    </button>
                    <button className="btn tiny danger-text" onClick={() => setConfirmDelete(t)}>حذف</button>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="device-hint">لا توجد دورات بعد — أنشئ أول دورة أعلاه.</p>
      )}

      {active && (
        <div className="tournament-editor">
          <div className="setting-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className={`tournament-led led-${ledState}`}
                title={tieReveal ? 'جاري قرعة حسم المتأهلين…' : reveal ? 'جاري سحب القرعة…' : ledState === 'red' ? 'الدورة منتهية' : ledState === 'green' ? 'الدورة جارية' : ledState === 'yellow' ? 'جاري القرعة' : 'بانتظار القرعة'}
              />
              <div>
                <strong>🏆 {active.name}</strong>
                <p className="device-hint">
                  {FORMAT_LABEL[active.format]} · {STAGE_LABEL[active.stage]} · {active.participants.length} مشترك
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {tieReveal && (
                <div className="reveal-progress" aria-label={`جاري قرعة حسم المتأهلين: ${tieReveal.revealed}/${tieReveal.total}`}>
                  <span className="reveal-progress-label">
                    {tieReveal.revealed < 1 ? 'جاري تجهيز قرعة الحسم…' : `جاري قرعة حسم المتأهلين… (${Math.min(tieReveal.revealed, tieReveal.total)}/${tieReveal.total})`}
                  </span>
                  <span className="reveal-progress-track">
                    <span
                      className="reveal-progress-fill"
                      style={{ width: `${tieReveal.total > 0 ? Math.min(100, (tieReveal.revealed / tieReveal.total) * 100) : 0}%` }}
                    />
                  </span>
                </div>
              )}
              {reveal && (
                <div className="reveal-progress" aria-label={`جاري سحب القرعة: ${reveal.revealed}/${reveal.total}`}>
                  <span className="reveal-progress-label">
                    {reveal.revealed < 1 ? 'جاري تجهيز القرعة…' : `جاري سحب القرعة… (${Math.min(reveal.revealed, reveal.total)}/${reveal.total})`}
                  </span>
                  <span className="reveal-progress-track">
                    <span
                      className="reveal-progress-fill"
                      style={{ width: `${reveal.total > 0 ? Math.min(100, (reveal.revealed / reveal.total) * 100) : 0}%` }}
                    />
                  </span>
                </div>
              )}
              <button
                className="btn primary"
                disabled={active.participants.length < 2 || !!reveal || !!tieReveal}
                onClick={() => { if (active.stage === 'pending') doDraw(); else setConfirmRedraw(true); }}
              >
                🎲 عمل قرعة عشوائية
              </button>
            </div>
          </div>

          {active.stage === 'pending' && !reveal ? (
            <>
              <div className="players-chips">
                {active.participants.map((p) => (
                  <span key={p} className="player-chip">
                    {p}
                    <button className="player-chip-del" onClick={() => removePlayer(p)} aria-label={`حذف ${p}`}>✕</button>
                  </span>
                ))}
              </div>
              <p className="device-hint">
                الإجمالي: {active.participants.length} مشترك
                {active.format === 'groups' ? ` · سيُوزعون على ${groupCount} مجموعات` : ''}
              </p>
              <div className="add-player-row">
                <input
                  value={newPlayer}
                  onChange={(e) => setNewPlayer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addPlayer(); }}
                  placeholder="اسم مشترك جديد…"
                />
                <button className="btn tiny" onClick={addPlayer}>+ إضافة مشترك</button>
              </div>
            </>
          ) : (
            <p className="device-hint">قائمة المشتركين ثابتة بعد القرعة ({active.participants.length} مشترك) — إعادة القرعة تخلط الأسماء وتوزّع من جديد من الصفر.</p>
          )}

          {active.format === 'knockout' && active.bracket.length === 0 && displayBracket.length === 0 && (
            <p className="device-hint" style={{ color: 'var(--amber)' }}>
              الدورة جاهزة للقرعة: اضغط «عمل قرعة عشوائية» لبناء شجرة خروج المغلوب تلقائياً.
            </p>
          )}

          {active.format === 'groups' && displayGroups.length > 0 && (
            <>
              <div className="tournament-groups">
                {displayGroups.map((g) => {
                  // نظام المجموعات: تظهر الحاويات فارغة أولاً، ثم يُكشف كل لاعب تباعاً (2000ms)، ثم المباريات واحدة واحدة.
                  if (!containersShown) return null;
                  const ranking = rankGroup(g);
                  return (
                    <div key={g.id} className={`tournament-group${reveal ? ' reveal-item' : ''}`}>
                      <h5>{g.name} <span className="device-hint">({g.matches.length} مباراة)</span></h5>
                      {ranking.length > 0 ? (
                        <table className="tbl">
                          <thead><tr><th>#</th><th>المشترك</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>له</th><th>عليه</th><th>الفرق</th><th>النقاط</th></tr></thead>
                          <tbody>
                            {ranking.map((r) => {
                              if (!isPlayerRevealed(g.id, r.player)) return null;
                              return (
                                <tr key={r.player} className={r.rank <= 2 ? 'qualify-row' : undefined}>
                                  <td>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank}</td>
                                  <td>{r.player}</td>
                                  <td>{r.played}</td>
                                  <td>{r.won}</td>
                                  <td>{r.drawn}</td>
                                  <td>{r.lost}</td>
                                  <td>{r.for}</td>
                                  <td>{r.against}</td>
                                  <td>{r.diff}</td>
                                  <td><strong>{r.points}</strong></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <p className="device-hint">لا توجد مباريات في هذه المجموعة.</p>
                      )}
                      {(() => {
                        // قرعة حسم التكافؤ: تظهر فقط عندما اكتملت مباريات المجموعة ووُجد تكافؤ فعلي
                        // في النقاط وفرق الأهداف يؤثر على مقعدَي التأهل (أول مركزين).
                        const groupDone = g.matches.length > 0 && g.matches.every((m) => m.scoreA !== undefined && m.scoreB !== undefined);
                        if (!groupDone || !!reveal) return null;
                        const tied = findQualificationTie(g);
                        const itsTie = tieReveal?.groupId === g.id;
                        if (!tied && !itsTie) return null;
                        if (itsTie && tieReveal) {
                          return (
                            <div className="tie-reveal reveal-item">
                              <strong>🎲 قرعة حسم المتأهلين — {Math.min(tieReveal.revealed, tieReveal.total)}/{tieReveal.total}</strong>
                              <div className="tie-order">
                                {tieReveal.order.map((p, i) => (
                                  <span key={p} className={i < tieReveal.revealed ? 'reveal-item' : 'slot-pending'}>
                                    {i < tieReveal.revealed ? p : '؟'}
                                  </span>
                                ))}
                              </div>
                              <div className="reveal-progress-track" style={{ marginTop: 8 }}>
                                <span className="reveal-progress-fill" style={{ width: `${tieReveal.total > 0 ? Math.min(100, (tieReveal.revealed / tieReveal.total) * 100) : 0}%` }} />
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="tie-zone reveal-item">
                            <span className="tie-callout">⚖️ تساوٍ في النقاط وفرق الأهداف يؤثّر على التأهل</span>
                            <button className="btn tie-btn" disabled={!!tieReveal} onClick={() => startTieReveal(g)}>
                              🎲 إجراء قرعة حسم المتأهلين
                            </button>
                          </div>
                        );
                      })()}
                      <div className="group-matches">
                        {g.matches.map((m) => {
                          // كل مقعد يُكشف على حدة: الطرف أولاً ثم خصمه بعد 2000ms (مثل خروج المغلوب).
                          const aR = isMatchSlotRevealed(g.id, m.id, 'A');
                          const bR = isMatchSlotRevealed(g.id, m.id, 'B');
                          if (!aR && !bR) return null;
                          return (
                            <div key={m.id} className="group-match">
                              <div className="gm-side">
                                {aR ? <span className="bracket-name reveal-item">{m.playerA}</span> : <span className="bracket-name slot-pending">؟</span>}
                                <input className="bracket-score" type="number" min={0} disabled={!!reveal} defaultValue={m.scoreA ?? ''} onChange={(e) => setGroupScore(active, g, m, 'A', e.target.value)} />
                              </div>
                              <span className="gm-sep">–</span>
                              <div className="gm-side">
                                <input className="bracket-score" type="number" min={0} disabled={!!reveal} defaultValue={m.scoreB ?? ''} onChange={(e) => setGroupScore(active, g, m, 'B', e.target.value)} />
                                {bR ? <span className="bracket-name reveal-item">{m.playerB}</span> : <span className="bracket-name slot-pending">؟</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn primary" disabled={!allGroupMatchesDone(active.groups) || !!reveal || !!tieReveal} onClick={buildPlayoff}>
                  ⚔️ بناء مرحلة الإقصاء (صعود أول مركزين من كل مجموعة)
                </button>
                {!allGroupMatchesDone(active.groups) && (
                  <span className="device-hint">سجّل نتائج كل مباريات المجموعات لتفعيل الصعود.</span>
                )}
              </div>
            </>
          )}

          {displayBracket.length > 0 && (
            <>
              <h5>🏆 {displayFormat === 'groups' ? 'مرحلة الإقصاء' : 'شجرة خروج المغلوب'} — الفائز يتقدم تلقائياً للمواجهة التالية</h5>
              <div className="bracket">
                {rounds.map((r) => {
                  const matches = displayBracket.filter((m) => m.round === r).sort((a, b) => a.bracketIndex - b.bracketIndex);
                  return (
                    <div key={r} className="bracket-round">
                      <strong className="bracket-round-label">{matches[0]?.label ?? ''}</strong>
                      <div className="bracket-matches">
                        {matches.map((m) => {
                          // الكشف لكل مقعد على حدة: يظهر اسم كل لاعب (A ثم B) بفاصل 2000ms.
                          const aR = isSlotRevealed(m.id, 'A');
                          const bR = isSlotRevealed(m.id, 'B');
                          if (!aR && !bR) return null;
                          return (
                            <div key={m.id} className={`bracket-match${reveal ? ' reveal-item' : ''}${m.winner ? ' decided' : ''}${m.auto ? ' auto' : ''}`}>
                              <div className={`bracket-slot${m.winner && m.winner === m.playerA ? ' win' : ''}`}>
                                {aR ? <span className="bracket-name reveal-item">{m.playerA ?? '—'}</span> : <span className="bracket-name slot-pending">؟</span>}
                                <input
                                  className="bracket-score"
                                  type="number" min={0}
                                  defaultValue={m.scoreA ?? ''}
                                  disabled={!m.playerA || !!m.auto || !!reveal}
                                  onChange={(e) => setKnockoutScore(active, m, 'A', e.target.value)}
                                />
                                {m.auto && m.winner === m.playerA && <span className="bracket-tag">تأهل</span>}
                              </div>
                              <div className={`bracket-slot${m.winner && m.winner === m.playerB ? ' win' : ''}`}>
                                {bR ? <span className="bracket-name reveal-item">{m.playerB ?? '—'}</span> : <span className="bracket-name slot-pending">؟</span>}
                                <input
                                  className="bracket-score"
                                  type="number" min={0}
                                  defaultValue={m.scoreB ?? ''}
                                  disabled={!m.playerB || !!m.auto || !!reveal}
                                  onChange={(e) => setKnockoutScore(active, m, 'B', e.target.value)}
                                />
                                {m.auto && m.winner === m.playerB && <span className="bracket-tag">تأهل</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {confirmRedraw && (
        <ConfirmDialog
          title="إعادة القرعة العشوائية"
          message="سيتم خلط الأسماء وإعادة توزيعها من جديد مع مسح النتائج والشجرة الحالية بالكامل. متابعة؟"
          confirmLabel="إعادة القرعة"
          onConfirm={() => { setConfirmRedraw(false); doDraw(); }}
          onClose={() => setConfirmRedraw(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="حذف الدورة"
          message={`حذف دورة «${confirmDelete.name}» نهائياً من قاعدة البيانات بما فيها قرعتها ونتائجها؟ لا يمكن التراجع عن هذا الإجراء.`}
          confirmLabel="حذف"
          onConfirm={() => { void deleteTournament(confirmDelete.id); if (selectedTournamentId === confirmDelete.id) setSelectedTournamentId(null); setConfirmDelete(null); }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
