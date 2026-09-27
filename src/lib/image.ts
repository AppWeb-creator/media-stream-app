/**
 * معالجة الصور محلياً على جهاز العميل فورياً: تُقرأ الصورة كـ DataURL (Base64) وتُختزل
 * عبر قماش (Canvas) إلى أبعاد معقولة قبل التحويل — ما يضمن عدم تعليق الرفع وحجماً خفيفاً
 * يُخزَّن داخل الإعدادات مباشرة (بدون رفع لخدمة تخزين خارجية).
 */

/** يقرأ ملف صورة ويُعادله DataURL مضغوطاً (أقصى بعد 1200px، جودة 0.82) — فوري دون انتظار خادم. */
export function fileToDataUrl(file: File, maxSize = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('الملف المختار ليس صورة'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('صيغة الصورة غير مدعومة'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('لا يمكن معالجة الصورة على هذا الجهاز'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}