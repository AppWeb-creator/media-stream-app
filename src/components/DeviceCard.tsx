import React, { useState } from 'react';
import { useStore, useTick, elapsedMs } from '../store/cafe';
import type { Device, Session } from '../lib/types';
import { orderLineNet } from '../lib/types';
import { fmtDuration, fmtMinutes, money } from '../lib/format';

interface Props {
  device: Device;
  session: Session | null;
  onStart: (deviceId: string) => void;
  onEnd: (session: Session) => void;
  onOrder: (session: Session) => void;
  onMute: (sessionId: string) => void;
}

function PS4Graphic() {
  return (
    <svg viewBox="0 0 240 110" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="psBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4d68" />
          <stop offset="1" stopColor="#151f2e" />
        </linearGradient>
        <linearGradient id="psLight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4fc3f7" />
          <stop offset="1" stopColor="#8b6bff" />
        </linearGradient>
        <linearGradient id="psGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.16)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <ellipse cx="126" cy="100" rx="104" ry="6" fill="rgba(0,0,0,0.35)" />
      <path d="M82 24 L202 24 L234 76 L52 66 Z" fill="url(#psBody)" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
      <path d="M52 66 L234 76 L234 92 L52 82 Z" fill="#0b111d" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      <path d="M88 30 L198 30 L224 68 L104 66 Z" fill="url(#psGloss)" />
      <path d="M70 62 L228 75" stroke="url(#psLight)" strokeWidth="9" strokeLinecap="round" />
      <line x1="60" y1="70" x2="88" y2="71" stroke="#05090f" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function DeviceCard({ device, session, onStart, onEnd, onOrder, onMute }: Props) {
  const { config, user, subtotalOf, cancelSession, extendSession, pauseSession, resumeSession, markCollected, myOpenShift } = useStore();
  const now = useTick(1000);
  const [customExtend, setCustomExtend] = useState('20');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);

  const limited = session?.type === 'limited' && session.limitedMinutes > 0;
  const remainingMs = limited ? session.limitedMinutes * 60000 - elapsedMs(session, now) : 0;
  const remainingMin = remainingMs / 60000;
  const warn = limited && remainingMin <= 10 && remainingMin > 2;
  const danger = limited && remainingMin <= 2 && remainingMs > 0;
  const expired = limited && remainingMs <= 0;
  const paused = !!session?.paused;
  // عند التقفيل (لا توجد وردية مفتوحة) تُطفأ كل أضواء الطاقة وتُصبح بنية داكنة بلا نبض.
  // أما مع وردية مفتوحة: متاح = أحمر، جلسة تعمل = أخضر، موقوفة = كهرماني، انتهى الوقت = مرجاني/خوخي.
  let ledState: 'off' | 'idle' | 'active' | 'paused' | 'expired';
  if (!myOpenShift) ledState = 'off';
  else if (expired) ledState = 'expired';
  else if (paused) ledState = 'paused';
  else ledState = session ? 'active' : 'idle';
  const ledTitle = !myOpenShift
    ? 'الوردية مغلقة — الأجهزة خارج الخدمة'
    : expired
      ? 'انتهى وقت الحجز'
      : paused
        ? 'الجلسة متوقفة مؤقتاً'
        : session
          ? 'الجلسة تعمل'
          : 'الجهاز متاح (جاهز)';

  // الفصل التام: الموظف لا يرى تفاصيل جلسات المدير إطلاقاً
  const lockedForStaff =
    !!session && user?.role === 'staff' && session.staff !== user.displayName;

  const rateLabel =
    session?.rateType === 'game'
      ? `جيم واحد · ${money(config.gameRate, config.currency)}`
      : `${session?.rateType === 'multi' ? 'ملتي' : 'فردي'} · ${money(session?.rateType === 'multi' ? config.multiRate : config.singleRate, config.currency)}/ساعة`;

  let cls = 'device-card idle';
  if (session) cls += ' active';
  if (limited) cls += danger ? ' danger' : warn ? ' warn' : '';
  if (expired) cls += ' expired';
  if (paused) cls += ' paused';

  const doExtend = (mins: number) => {
    if (mins <= 0 || !session) return;
    void extendSession(session, mins).catch((e) => alert(e.message));
  };

  return (
    <div className={cls}>
      <div className="device-head">
        <div className="device-name">
          <span className="device-glyph">🎮</span>
          <span>{device.name}</span>
        </div>
        <div className="device-head-actions">
          {session && limited && (
            <button
              className="btn ghost tiny"
              onClick={() => onMute(session.id)}
              title="كتم صوت تنبيهات هذه الجلسة فقط"
            >
              🔇
            </button>
          )}
          <span className={`pill ${paused ? 'paused' : session ? 'on' : 'off'}`}>{paused ? 'متوقف مؤقتاً' : session ? 'مشغول' : 'متاح'}</span>
        </div>
      </div>

      <div className="device-figure">
        {config.deviceGraphicUrl ? (
          <img src={config.deviceGraphicUrl} alt="الجهاز" />
        ) : (
          <PS4Graphic />
        )}
        <span
          className={`ps-led led-${ledState}`}
          aria-hidden="true"
          title={ledTitle}
        />
      </div>

      {!session && (
        <div className="device-body">
          <p className="device-hint">جاهز لاستقبال اللاعبين</p>
          <button className="btn primary full" onClick={() => onStart(device.id)}>بدء جلسة</button>
        </div>
      )}

      {session && lockedForStaff && (
        <div className="device-body">
          <div className="timer timer-locked">🔒</div>
          <p className="device-hint">جلسة إدارية قيد التشغيل على هذا الجهاز — لا يمكن عرض تفاصيلها أو التعديل عليها.</p>
        </div>
      )}

      {session && !lockedForStaff && (
        <div className="device-body">
          {paused && (
            <div className="paused-banner">⏸ الجلسة متوقفة مؤقتاً — العداد والتكلفة مجمّدة</div>
          )}
          <div className={`timer ${paused ? 'timer-paused' : limited ? (danger || expired ? 'timer-danger' : warn ? 'timer-warn' : 'timer-limited') : ''}`}>
            {limited
              ? (remainingMs > 0 ? fmtDuration(remainingMs) : 'انتهى الوقت')
              : fmtDuration(elapsedMs(session, now))}
          </div>
          <div className="timer-meta">
            {limited ? (
              <span className="tag">عد تنازلي {fmtMinutes(session.limitedMinutes)}</span>
            ) : (
              <span className="tag">وقت مفتوح</span>
            )}
            <span className="tag">{rateLabel}</span>
            {session.rateType === 'game' && (
              <span className="tag">الجيمات: {session.gamesCount ?? 0}</span>
            )}
          </div>

          {limited && !session.collected && (
            <div className={`collect-box ${collectOpen ? 'open' : ''}`}>
              {!collectOpen ? (
                <button className="collect-trigger" onClick={() => setCollectOpen(true)}>
                  <span className="collect-dot" />
                  هل تم تحصيل المبلغ؟
                </button>
              ) : (
                <div className="collect-expand">
                  <span className="collect-question">هل تم تحصيل المبلغ؟</span>
                  <div className="collect-options">
                    <button className="collect-no" onClick={() => setCollectOpen(false)}>لا</button>
                    <button
                      className="collect-yes"
                      onClick={() => { void markCollected(session); setCollectOpen(false); }}
                    >
                      نعم
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {limited && session.collected && (
            <div className="collect-box">
              <span className="collected-badge">✓ تم استلام المبلغ بنجاح</span>
            </div>
          )}

          <div className="cost-row">
            <span>التكلفة الحالية</span>
            <strong>{money(subtotalOf(session, now).subtotal, config.currency)}</strong>
          </div>

          {session.orders.length > 0 && (
            <div className="orders-mini">
              {session.orders.map((o) => (
                <div key={o.itemId} className="orders-line">
                  <span>{o.name} ×{o.qty}</span>
                  <span>{money(orderLineNet(o), config.currency)}</span>
                </div>
              ))}
            </div>
          )}

          {expired && (
            <div className="extend-box">
              <span className="extend-title">انتهى الوقت — تمديد الجلسة؟</span>
              <div className="extend-actions">
                <button className="btn primary" onClick={() => doExtend(15)}>+15 دقيقة</button>
                <button className="btn" onClick={() => doExtend(30)}>+30 دقيقة</button>
                <button className="btn" onClick={() => doExtend(60)}>+60 دقيقة</button>
              </div>
              <div className="extend-custom">
                <input
                  type="number" min={1} placeholder="مدة مخصصة"
                  value={customExtend}
                  onChange={(e) => setCustomExtend(e.target.value)}
                />
                <button className="btn primary" onClick={() => doExtend(Math.max(1, Number(customExtend) || 0))}>
                  تمديد مخصص (دقيقة)
                </button>
              </div>
            </div>
          )}

          <div className="device-actions">
            <button className="btn" onClick={() => onOrder(session)}>+ طلب</button>
            {!expired && (
              paused ? (
                <button className="btn success" onClick={() => void resumeSession(session).catch((e) => alert(e.message))}>▶ استئناف</button>
              ) : (
                <button className="btn warn" onClick={() => void pauseSession(session).catch((e) => alert(e.message))}>⏸ إيقاف مؤقت</button>
              )
            )}
            <button className="btn primary" onClick={() => onEnd(session)}>حساب الفاتورة</button>
          </div>
          {/* إلغاء الجلسة بدون تحصيل — متاح للموظف والمدير على حد سواء، ولا يُسجَّل أي مبلغ. */}
          <button
            className="btn ghost tiny danger-text"
            onClick={() => setConfirmCancel(true)}
          >
            إلغاء الجلسة (بدون تحصيل)
          </button>
        </div>
      )}

      {confirmCancel && session && (
        <div className="overlay" onClick={() => setConfirmCancel(false)}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>⚠ إلغاء الجلسة بدون تحصيل</h3>
              <button className="x" onClick={() => setConfirmCancel(false)}>×</button>
            </div>
            <p className="device-hint">
              سيتم إلغاء جلسة <strong>{session.deviceName}</strong> نهائياً بدون تسجيل أي مبلغ. لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmCancel(false)}>تراجع</button>
              <button
                className="btn danger"
                onClick={() => { void cancelSession(session); setConfirmCancel(false); }}
              >
                تأكيد الإلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
