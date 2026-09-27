import React, { useMemo, useState } from 'react';
import { useStore } from '../store/cafe';
import { unlockAudio, alertError } from '../lib/audio';
import logoUrl from '../assets/logo.png';

export function Login() {
  const { login, online, users, config } = useStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const siteName = config.siteName || 'بلايستيشن أحمد الشريف';

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ar') : a.role === 'admin' ? -1 : 1)),
    [users],
  );

  const submit = () => {
    if (!username || !pin) {
      setError('أدخل اسم المستخدم ورمز الدخول');
      return;
    }
    const failure = login(username, pin);
    if (failure === null) {
      unlockAudio();
      setError('');
    } else {
      setError(failure);
      alertError();
    }
  };

  const pressKey = (k: string) => {
    if (k === 'C') setPin('');
    else if (k === '<') setPin((p) => p.slice(0, -1));
    else if (pin.length < 6) setPin((p) => p + k);
  };

  const quickFill = (u: string) => {
    setUsername(u);
    setPin('');
  };

  return (
    <div className="login-screen">
      <div className="login-card login-card-wide">
        <div className="login-brand-col">
          <img className="login-logo-img lg-hero" src={config.logoUrl || logoUrl} alt={siteName} />
          <h1 className="login-title">{siteName}</h1>
          <p className="login-sub">سجّل الدخول لفتح لوحة التحكم</p>
          <p className={`conn ${online ? 'ok' : 'bad'} login-sync`}>
            <span className="conn-dot" />
            {online ? 'متصل بالمزامنة السحابية' : 'غير متصل — سيتم المزامنة عند عودة الاتصال'}
          </p>

          <div className="login-user-row">
            {sortedUsers.map((u) => (
              <button
                key={u.id}
                className={`user-chip ${username === u.username ? 'active' : ''}`}
                onClick={() => quickFill(u.username)}
              >
                <span
                  className={`user-chip-led ${u.role === 'admin' ? 'led-admin' : 'led-staff'}`}
                  aria-hidden="true"
                  title={u.role === 'admin' ? 'مدير' : 'موظف'}
                />
                <span className="user-chip-name">{u.displayName}</span>
                <span className={`user-chip-role ${u.role === 'admin' ? 'admin' : 'staff'}`}>
                  {u.role === 'admin' ? 'مدير' : 'موظف'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="login-auth-col">
          <div className="pin-panel">
            <div className="pin-dots">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={i < pin.length ? 'filled' : ''} />
              ))}
            </div>

            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'].map((k) => (
                <button key={k} onClick={() => pressKey(k)}>{k === '<' ? '⌫' : k === 'C' ? 'مسح' : k}</button>
              ))}
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}
          <button className="btn primary full login-submit" onClick={submit}>تسجيل الدخول</button>
        </div>
      </div>
    </div>
  );
}
