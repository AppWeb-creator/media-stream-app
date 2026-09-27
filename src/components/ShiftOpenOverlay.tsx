import React, { useEffect, useState } from 'react';

interface Props {
  kind: 'open' | 'close';
  userName: string;
  avatarUrl?: string;
  fallbackLogo?: string;
}

/** تراكب سينمائي مصغّر عند فتح/قفل الوردية: خلفية داكنة ضبابية، صورة المستخدم الدائرية في المنتصف، ونص عائم.
 *  يتم الإغلاق من المكوّن الأب عبر مؤقت setTime يضبط الحالة على false، بينما يتولى هذا المكوّن تلاشي الإغلاق فقط. */
export function ShiftOpenOverlay({ kind, userName, avatarUrl, fallbackLogo }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), 2900);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className={`shift-open-overlay ${leaving ? 'out' : ''}`} role="status" aria-live="polite">
      <div className="shift-open-avatar">
        <img src={avatarUrl || fallbackLogo} alt="صورة المستخدم" />
      </div>
      <div className="shift-open-text">
        {kind === 'open' ? (
          <>
            <div className="shift-open-title">أهلاً بك، {userName}</div>
            <div className="shift-open-sub">تم فتح الوردية بنجاح</div>
          </>
        ) : (
          <>
            <div className="shift-open-title">تم قفل الوردية</div>
            <div className="shift-open-sub">إلى اللقاء، {userName}</div>
          </>
        )}
      </div>
    </div>
  );
}