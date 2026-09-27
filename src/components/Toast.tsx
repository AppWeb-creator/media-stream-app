import React, { useEffect, useRef, useState } from 'react';

interface Props {
  type: 'ok' | 'err';
  text: string;
  duration?: number;
  onDone: () => void;
}

/** إشعار منبثق سريع داخل التطبيق (بديل عن alert()) — يختفي تلقائياً وتدريجياً بعد 3 ثوانٍ. */
export function Toast({ type, text, duration = 3000, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  // نحفظ أحدث onDone في ref حتى لا يعيد تغيّر هويّته ضبط المؤقّت وإلغاء الإخفاء.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    // يبدأ التلاشي عند انتهاء المدة، ثم يُزال الإشعار نهائياً بعد انتهاء الانتقال.
    const fadeTimer = window.setTimeout(() => setLeaving(true), duration);
    const removeTimer = window.setTimeout(() => onDoneRef.current(), duration + 320);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [duration]);

  return (
    <div className={`toast toast-${type} ${leaving ? 'out' : ''}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}