import { formatKwh, formatPercent } from '@riviamigo/ui/lib/utils';
import type { PhantomDrainPeriod } from '@riviamigo/types';

export interface PhantomDrainSummary {
  maxDrainPct: number;
  avgSleepPct: number | null;
  avgStateCoveragePct: number | null;
  totalEnergyDrainedKwh: number;
  avgDrainPctPerHour: number | null;
}

export interface PhantomDrainSummaryCard {
  key: string;
  title: string;
  value: string;
  icon: string;
  accentBorder?: boolean;
  secondary?: string;
}

function formatRatioPercent(value: number | null, decimals = 0) {
  return value == null ? '-' : formatPercent(value * 100, decimals);
}

export function summarizePhantomDrainPeriods(periods: PhantomDrainPeriod[]): PhantomDrainSummary {
  const maxDrainPct = periods.reduce((max, period) => {
    if (period.soc_lost_pct == null || Number.isNaN(period.soc_lost_pct)) return max;
    return Math.max(max, period.soc_lost_pct);
  }, 0);

  const weightedSleep = periods.reduce(
    (acc, period) => {
      const duration = finiteNumber(period.duration_hours);
      const sleepShare = finiteNumber(period.sleep_share_pct);
      if (duration == null || sleepShare == null) return acc;
      acc.weightedSum += duration * sleepShare;
      acc.durationSum += duration;
      return acc;
    },
    { weightedSum: 0, durationSum: 0 }
  );
  const avgSleepPct = weightedSleep.durationSum > 0 ? weightedSleep.weightedSum / weightedSleep.durationSum : null;

  const weightedCoverage = periods.reduce(
    (acc, period) => {
      const duration = finiteNumber(period.duration_hours);
      const coverage = finiteNumber(period.state_coverage_pct);
      if (duration == null || coverage == null) return acc;
      acc.weightedSum += duration * coverage;
      acc.durationSum += duration;
      return acc;
    },
    { weightedSum: 0, durationSum: 0 }
  );
  const avgStateCoveragePct = weightedCoverage.durationSum > 0 ? weightedCoverage.weightedSum / weightedCoverage.durationSum : null;

  const totalEnergyDrainedKwh = periods.reduce((sum, period) => {
    if (period.energy_drained_kwh == null || Number.isNaN(period.energy_drained_kwh)) return sum;
    return sum + period.energy_drained_kwh;
  }, 0);

  const totalDurationHours = periods.reduce((sum, period) => {
    const duration = finiteNumber(period.duration_hours);
    return duration == null ? sum : sum + duration;
  }, 0);
  const totalSocLostPct = periods.reduce((sum, period) => {
    const lost = finiteNumber(period.soc_lost_pct);
    return lost == null ? sum : sum + lost;
  }, 0);
  const avgDrainPctPerHour = totalDurationHours > 0 ? totalSocLostPct / totalDurationHours : null;

  return {
    maxDrainPct,
    avgSleepPct,
    avgStateCoveragePct,
    totalEnergyDrainedKwh,
    avgDrainPctPerHour,
  };
}

export function buildPhantomDrainSummaryCards(summary: PhantomDrainSummary): PhantomDrainSummaryCard[] {
  return [
    {
      key: 'max-drain',
      title: 'Max drain',
      value: formatPercent(summary.maxDrainPct, 2),
      icon: 'lucide:activity',
      accentBorder: true,
    },
    {
      key: 'avg-sleep',
      title: 'Avg sleep',
      value: formatRatioPercent(summary.avgSleepPct, 1),
      icon: 'lucide:moon-star',
      secondary: `State coverage ${summary.avgStateCoveragePct == null ? 'unknown' : formatRatioPercent(summary.avgStateCoveragePct, 0)}`,
    },
    {
      key: 'total-energy-drained',
      title: 'Total energy drained',
      value: formatKwh(summary.totalEnergyDrainedKwh),
      icon: 'lucide:bolt',
    },
    {
      key: 'avg-drain-per-hour',
      title: 'Avg drain per hour',
      value: summary.avgDrainPctPerHour == null ? '-' : `${formatPercent(summary.avgDrainPctPerHour, 2)} / h`,
      icon: 'lucide:timer',
    },
  ];
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
