import { useMemo } from 'react';
import type { Config, MatchEntry } from './types';
import { effectiveMatches } from './matches';

/**
 * خطاف المباريات الحية: يبني قائمة المباريات الفعلية (يدوية فقط من لوحة الإدارة — لا جلب تلقائي
 * من يلا كورة) مرتبة حسب الموعد. لا نافذة عرض: كل المباريات المحفوظة تُعرض في الجرس والشارة.
 */
export function useMatches(config: Config): MatchEntry[] {
  return useMemo(() => effectiveMatches(config.matches), [config.matches]);
}