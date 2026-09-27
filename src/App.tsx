import React from 'react';
import { StoreProvider, useStore } from './store/cafe';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { MaintenanceLock } from './components/MaintenanceLock';
import logoUrl from './assets/logo.png';

function Gate() {
  const { user, ready, online, config } = useStore();
  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-card">
          <img className="login-logo-img" src={config.logoUrl || logoUrl} alt="الشعار" />
          <p>جارٍ الاتصال بالسحابة…</p>
          <p className={`conn ${online ? 'ok' : 'bad'}`}>
            {online ? 'جارٍ المزامنة مع Firestore' : 'غير متصل — جارٍ إعادة المحاولة'}
          </p>
        </div>
      </div>
    );
  }
  if (!user) return <Login />;
  // وضع الصيانة: يُمنع الموظفون من الوصول خلال جلسة مفتوحة بالفعل، ويبقى المدير متاحاً للعمل بطريقة طبيعية.
  if (config.maintenanceMode && user.role !== 'admin') return <MaintenanceLock />;
  return <Dashboard />;
}

export default function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  );
}
