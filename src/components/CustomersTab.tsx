import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/cafe';
import { fmtDateTimeFull } from '../lib/format';
import { ConfirmDialog } from './ConfirmDialog';
import { Toast } from './Toast';
import type { Customer } from '../lib/types';

const TEMPLATE_KEY = 'pscafe.offerTemplate';
const DEFAULT_TEMPLATE = '🎉 عرض خاص! تعال استمتع بوقتك معنا بخصومات وتخفيضات لفترة محدودة ⏳ لا تفوّت الفرصة 😉';

interface FormState {
  id: string | null;
  name: string;
  phone: string;
  facebookUrl: string;
  notes: string;
}

/**
 * تبويب إدارة الزبائن — إضافة/تعديل/حذف الزبائن مع البحث، وصندوق العروض والمراسلة
 * (نسخ نص العرض + فتح Messenger / فتح WhatsApp برسالة جاهزة).
 */
export function CustomersTab() {
  const { customers, addCustomer, updateCustomer, deleteCustomer } = useStore();
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState(() => {
    try { return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; }
  });
  const [form, setForm] = useState<FormState | null>(null);
  const [formErr, setFormErr] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; label: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; type: 'ok' | 'err'; text: string } | null>(null);
  const toastSeq = useRef(0);

  const showToast = (type: 'ok' | 'err', text: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, type, text });
  };

  const handleTemplate = (value: string) => {
    setTemplate(value);
    try { localStorage.setItem(TEMPLATE_KEY, value); } catch { /* تجاهل */ }
  };

  // البحث بالاسم أو رقم الهاتف (الأرقام تُطبع بدون رموز للمطابقة السريعة).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qNum = q.replace(/\D/g, '');
    if (!q) return customers;
    return customers.filter((c) => {
      const byName = c.name.toLowerCase().includes(q);
      const byPhone = qNum.length > 0 && c.phone.replace(/\D/g, '').includes(qNum);
      return byName || byPhone;
    });
  }, [customers, query]);

  const openAdd = () => {
    setFormErr('');
    setForm({ id: null, name: '', phone: '', facebookUrl: '', notes: '' });
  };

  const openEdit = (c: Customer) => {
    setFormErr('');
    setForm({ id: c.id, name: c.name, phone: c.phone, facebookUrl: c.facebookUrl, notes: c.notes });
  };

  const save = async () => {
    if (!form) return;
    setFormErr('');
    if (!form.name.trim()) {
      setFormErr('يرجى إدخال اسم الزبون');
      return;
    }
    setFormBusy(true);
    try {
      if (form.id) {
        await updateCustomer(form.id, { name: form.name, phone: form.phone, facebookUrl: form.facebookUrl, notes: form.notes });
        showToast('ok', 'تم حفظ بيانات الزبون ✓');
      } else {
        await addCustomer(form.name, form.phone, form.facebookUrl, form.notes);
        showToast('ok', 'تمت إضافة الزبون بنجاح ✓');
      }
      setForm(null);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'فشل حفظ الزبون');
    } finally {
      setFormBusy(false);
    }
  };

  const copyText = (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // بديل للمتصفحات التي لا تدعم Clipboard API (يُنفذ النسخ عبر عنصر مؤقت).
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch {
        reject(new Error('copy failed'));
      }
    });
  };

  const message = () => template.trim() || DEFAULT_TEMPLATE;

  // نسخ نص العرض إلى الحافظة ثم فتح رابط فيسبوك/ماسنجر الزبون في تبويب جديد.
  const copyAndOpenMessenger = (c: Customer) => {
    const link = c.facebookUrl.trim();
    if (!link) {
      void copyText(message())
        .then(() => showToast('err', 'لا يوجد رابط فيسبوك/ماسنجر مسجل لهذا الزبون — تم نسخ النص فقط'))
        .catch(() => showToast('err', 'تعذر النسخ التلقائي ✕'));
      return;
    }
    void copyText(message())
      .then(() => showToast('ok', 'تم نسخ نص العرض إلى الحافظة ✓'))
      .catch(() => showToast('err', 'تعذر النسخ التلقائي — انسخ النص يدوياً ✕'));
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // فتح واتساب ويب برقم الزبون (بصيغة دولية) مع نص العرض معبأ مسبقاً — الرابط المباشر يتجنب الصفحة البيضاء.
  const openWhatsApp = (c: Customer) => {
    const q = c.phone.replace(/\D/g, '');
    if (!q) {
      showToast('err', 'لا يوجد رقم هاتف مسجل لهذا الزبون');
      return;
    }
    // توحيد الرقم إلى الصيغة الدولية: أرقام مصرية تبدأ بـ 0 تُسبق بمعامل الدولة 2 (201026408758 مثلاً).
    const sanitizedPhone = q.startsWith('0') ? `2${q}` : q;
    window.open(`https://web.whatsapp.com/send?phone=${sanitizedPhone}&text=${encodeURIComponent(message())}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="admin-body">
      {/* صندوق العروض والمراسلة — يُنسخ إلى العملاء */}
      <section>
        <h4>📣 صندوق العروض والمراسلة</h4>
        <label className="field-label">نص العرض / الرسالة</label>
        <textarea
          rows={3}
          value={template}
          onChange={(e) => handleTemplate(e.target.value)}
          placeholder="اكتب نص العرض أو الرسالة هنا…"
        />
        <p className="device-hint">اكتب نص العرض مرة واحدة، ثم استخدم أزرار "نسخ + فتح Messenger" أو "فتح WhatsApp" عند أي زبون في القائمة.</p>
      </section>

      {/* إدارة الزبائن */}
      <section>
        <div className="customers-toolbar">
          <h4>الزبائن ({customers.length})</h4>
          <input
            className="customers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 ابحث بالاسم أو رقم الهاتف…"
          />
          <button className="btn primary" onClick={openAdd}>+ إضافة زبون جديد</button>
        </div>

        <table className="tbl">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>رقم الهاتف</th>
              <th>تاريخ التسجيل</th>
              <th>الملاحظات</th>
              <th>المراسلة</th>
              <th>التحكم</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const hasPhone = c.phone.replace(/\D/g, '').length > 0;
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.facebookUrl.trim() && (
                      <>
                        {' '}
                        <a href={c.facebookUrl.trim()} target="_blank" rel="noopener noreferrer" title={c.facebookUrl.trim()}>🔗</a>
                      </>
                    )}
                  </td>
                  <td dir="ltr">{c.phone || '-'}</td>
                  <td>{fmtDateTimeFull(c.createdAt)}</td>
                  <td>{c.notes || '-'}</td>
                  <td className="cell-actions">
                    <button className="btn tiny" onClick={() => copyAndOpenMessenger(c)} title="نسخ نص العرض إلى الحافظة وفتح ماسنجر الزبون">
                      📋 نسخ + فتح Messenger
                    </button>
                    <button
                      className="btn tiny"
                      onClick={() => openWhatsApp(c)}
                      disabled={!hasPhone}
                      title={hasPhone ? 'فتح واتساب برسالة جاهزة' : 'لا يوجد رقم هاتف مسجل لهذا الزبون'}
                    >
                      🟢 فتح WhatsApp
                    </button>
                  </td>
                  <td className="cell-actions">
                    <button className="btn tiny" onClick={() => openEdit(c)}>✏ تعديل</button>
                    <button className="btn tiny danger-text" onClick={() => setToDelete({ id: c.id, label: c.name })}>✕ حذف</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="device-hint">{customers.length === 0 ? 'لا يوجد زبائن مسجلون بعد. اضغط "إضافة زبون جديد" للبدء.' : 'لا توجد نتائج مطابقة للبحث.'}</p>
        )}
      </section>

      {/* نافذة إضافة / تعديل زبون */}
      {form && (
        <div className="overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{form.id ? '✏ تعديل بيانات الزبون' : '＋ إضافة زبون جديد'}</h3>
              <button className="x" onClick={() => setForm(null)}>×</button>
            </div>

            <div className="two-col">
              <div>
                <label className="field-label">اسم الزبون *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: محمد علي" />
              </div>
              <div>
                <label className="field-label">رقم الهاتف</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01xxxxxxxxx" dir="ltr" />
              </div>
              <div>
                <label className="field-label">رابط الفيسبوك / الماسنجر</label>
                <input
                  value={form.facebookUrl}
                  onChange={(e) => setForm({ ...form, facebookUrl: e.target.value })}
                  placeholder="https://m.me/username أو https://facebook.com/username"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="field-label">ملاحظات</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="أي تفاصيل إضافية عن الزبون" />
              </div>
            </div>

            {formErr && <p className="modal-error">{formErr}</p>}
            <button className="btn primary" onClick={() => void save()} disabled={formBusy}>
              {formBusy ? 'جارٍ الحفظ…' : '💾 حفظ'}
            </button>
            <button className="btn" onClick={() => setForm(null)} style={{ marginRight: '8px' }}>إلغاء</button>
          </div>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`حذف الزبون ${toDelete.label}`}
          message={`هل أنت متأكد من حذف الزبون "${toDelete.label}" نهائياً؟ لن يظهر في دفتر الزبائن بعد الآن.`}
          confirmLabel="حذف"
          onConfirm={() => {
            void deleteCustomer(toDelete.id)
              .then(() => showToast('ok', 'تم حذف الزبون ✓'))
              .catch((err: Error) => showToast('err', err.message || 'فشل حذف الزبون ✕'));
            setToDelete(null);
          }}
          onClose={() => setToDelete(null)}
        />
      )}

      {toast && (
        <Toast key={toast.id} type={toast.type} text={toast.text} onDone={() => setToast(null)} />
      )}
    </div>
  );
}