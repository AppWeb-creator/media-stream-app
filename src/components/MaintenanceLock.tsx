import React from 'react';
import { useStore } from '../store/cafe';
import logoUrl from '../assets/logo.png';

/**
 * شاشة قفل كاملة تُعرض للموظفين (staff) عندما يكون "وضع الصيانة" مفعّلاً من لوحة الإدارة.
 * تمنع الوصول إلى لوحة التحكم وأي عمليات، حتى لو كان الموظف مسجّلاً دخوله بالفعل.
 * حسابات المدير (admin) لا تتأثر وتستمر بالعمل بشكل طبيعي.
 */
export function MaintenanceLock() {
  const { user, logout } = useStore();

  return (
    <div className="boot">
      <div className="boot-card maintenance-card">
        <img className="login-logo-img" src={logoUrl} alt="الشعار" />
        <div className="maintenance-icon">🛠</div>
        <h2>النظام في وضع الصيانة</h2>
        <p>
          تم تفعيل وضع الصيانة من قِبل المدير حالياً. الدخول وتنفيذ العمليات متاح للمدير فقط في هذا الوقت.
        </p>
        <p className="device-hint">
          {user ? `مرحباً ${user.displayName} — يرجى المحاولة لاحقاً أو التواصل مع المدير.` : 'يرجى المحاولة لاحقاً.'}
        </p>
        <button className="btn primary full" onClick={logout}>تسجيل الخروج</button>
      </div>
    </div>
  );
}
