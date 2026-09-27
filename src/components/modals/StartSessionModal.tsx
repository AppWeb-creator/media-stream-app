import React, { useState } from 'react';
import { useStore } from '../../store/cafe';
import { money } from '../../lib/format';
import type { RateType } from '../../lib/types';

interface Props {
  deviceId: string;
  onClose: () => void;
}

const QUICK_MINUTES = [30, 60, 90, 120];
const GAME_MINUTES = 20;

type Mode = 'open' | 'limited' | 'game';

export function StartSessionModal({ deviceId, onClose }: Props) {
  const { devices, config, startSession } = useStore();
  const device = devices.find((d) => d.id === deviceId);
  const [mode, setMode] = useState<Mode>('open');
  const [rateType, setRateType] = useState<RateType>('single');
  const [minutes, setMinutes] = useState(60);
  const [err, setErr] = useState('');

  if (!device) return null;

  const go = async () => {
    try {
      if (mode === 'game') {
        // جيم واحد: جلسة محدودة تلقائياً بـ 20 دقيقة
        await startSession(deviceId, 'limited', 'game', GAME_MINUTES);
      } else {
        await startSession(deviceId, mode, rateType, minutes);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل بدء الجلسة');
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>بدء جلسة — {device.name}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <label className="field-label">نوع الجلسة</label>
        <div className="seg seg-three">
          <button className={mode === 'open' ? 'seg-on' : ''} onClick={() => setMode('open')}>
            ⏱ وقت مفتوح
            <small>عدّاد مباشر والدفع حسب الوقت</small>
          </button>
          <button className={mode === 'limited' ? 'seg-on' : ''} onClick={() => setMode('limited')}>
            ⏳ وقت محدد
            <small>عد تنازلي مع تنبيه عند الانتهاء</small>
          </button>
          <button className={mode === 'game' ? 'seg-on' : ''} onClick={() => setMode('game')}>
            🎮 جيم واحد
            <small>{GAME_MINUTES} دقيقة بسعر {money(config.gameRate, config.currency)}</small>
          </button>
        </div>

        {mode === 'limited' && (
          <>
            <label className="field-label">المدة (بالدقائق)</label>
            <div className="chip-row">
              {QUICK_MINUTES.map((m) => (
                <button key={m} className={`chip ${minutes === m ? 'chip-on' : ''}`} onClick={() => setMinutes(m)}>{m}</button>
              ))}
              <input
                type="number" min={5} value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="chip-input"
              />
            </div>
          </>
        )}

        {mode === 'game' && (
          <p className="device-hint">ستبدأ جلسة {GAME_MINUTES} دقيقة وتُحتسب جيماً واحداً ({money(config.gameRate, config.currency)}). كل تمديد لاحق يضيف جيماً آخر.</p>
        )}

        {/* خيارا الفردي والملتي يظهران فقط للوقت المفتوح والمحدد */}
        {mode !== 'game' && (
          <>
            <label className="field-label">نظام الحساب</label>
            <div className="seg">
              <button className={rateType === 'single' ? 'seg-on' : ''} onClick={() => setRateType('single')}>
                فردي (Single)
                <small>{money(config.singleRate, config.currency)} / ساعة</small>
              </button>
              <button className={rateType === 'multi' ? 'seg-on' : ''} onClick={() => setRateType('multi')}>
                ملتي (Multi)
                <small>{money(config.multiRate, config.currency)} / ساعة</small>
              </button>
            </div>
          </>
        )}

        {err && <p className="modal-error">{err}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={() => void go()}>
            {mode === 'game' ? 'بدء الجيم' : 'بدء الجلسة'}
          </button>
        </div>
      </div>
    </div>
  );
}
