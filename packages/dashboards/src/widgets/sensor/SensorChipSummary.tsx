import React from 'react';
import {
  CHART_COLORS,
  getChartColor,
  type MiniSparklineYDomain,
  type TimeFilterWindow,
} from '@riviamigo/ui/charts';
import { useDocumentPalette, useDocumentTheme } from '@riviamigo/ui/hooks';
import {
  getSensorDefinition,
  resolveSensorValueColor,
  type SensorDataAccent,
  type SensorIconKey,
  type SensorValueColor,
} from './sensorDefinitions';
import { SensorChipCard, SensorChipValue } from './SensorChipCard';

type SensorChipHistoryPoint = { ts?: string; value: number | null | undefined };
type SensorValueTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface SensorChipSummaryProps {
  title: string;
  value: React.ReactNode;
  /**
   * Shared sensor definition to inherit icon, data accent, value color, and
   * accent border from, so page headline chips match their dashboard twins.
   * Explicit props still win.
   */
  definitionId?: string;
  icon?: SensorIconKey;
  secondary?: string | undefined;
  labelSuffix?: string;
  subtitle?: string;
  accentBorder?: boolean;
  dataAccent?: SensorDataAccent;
  valueColor?: SensorValueColor;
  valueTone?: SensorValueTone;
  valueSize?: 'sm' | 'md' | 'lg';
  history?: SensorChipHistoryPoint[];
  historyColor?: string;
  historyDomain?: MiniSparklineYDomain;
  historyTimeFilter?: TimeFilterWindow;
}

const TONE_CLASS: Record<Exclude<SensorValueTone, 'neutral'>, string> = {
  success: 'text-status-positive',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  info: 'text-status-info',
};

/**
 * A sensor chip for page headlines, fed a value directly instead of a
 * dashboard data source. It renders through the same `SensorChipCard` as the
 * dashboard sensor widget, so it is the same chip, not a look-alike.
 */
export function SensorChipSummary({
  title,
  value,
  definitionId,
  icon: iconProp,
  secondary,
  labelSuffix,
  subtitle,
  accentBorder: accentBorderProp,
  dataAccent: dataAccentProp,
  valueColor: valueColorProp,
  valueTone,
  valueSize = 'md',
  history,
  historyColor,
  historyDomain,
  historyTimeFilter,
}: SensorChipSummaryProps) {
  const definition = getSensorDefinition(definitionId);
  const icon = iconProp ?? definition?.icon;
  const dataAccent = dataAccentProp ?? definition?.dataAccent;
  const valueColor = valueColorProp ?? definition?.valueColor ?? 'accent';
  const accentBorder = accentBorderProp ?? definition?.accent ?? false;
  const palette = useDocumentPalette();
  const isDark = useDocumentTheme();
  const colorToken = palette === 'rad' && dataAccent ? dataAccent : 'accent';
  const metricColor = getChartColor(colorToken);
  const metricValueColor = resolveSensorValueColor(undefined, colorToken, metricColor, isDark);
  const toneClass = valueTone && valueTone !== 'neutral' ? TONE_CLASS[valueTone] : undefined;
  const valueToneClass = toneClass ?? (valueColor === 'accent' ? 'text-accent' : 'text-fg');
  const valueStyle = !toneClass && valueColor === 'data' ? { color: metricValueColor } : undefined;
  const spriteColor = historyColor ?? metricColor ?? CHART_COLORS.accent;

  return (
    <SensorChipCard
      title={title}
      {...(labelSuffix ? { labelSuffix } : {})}
      {...(subtitle ? { subtitle } : {})}
      icon={icon}
      {...(dataAccent ? { iconColor: metricColor } : {})}
      {...(toneClass ? { iconToneClass: toneClass } : {})}
      accentBorder={accentBorder}
      accentColor={metricColor}
      {...(history?.length
        ? {
            sprite: {
              data: history,
              type: 'line' as const,
              color: spriteColor,
              ...(historyTimeFilter ? { timeFilter: historyTimeFilter } : {}),
              ...(historyDomain ? { yDomain: historyDomain } : {}),
            },
          }
        : {})}
      value={
        <SensorChipValue toneClass={valueToneClass} {...(valueStyle ? { style: valueStyle } : {})} size={valueSize}>
          {value}
        </SensorChipValue>
      }
      secondary={secondary ?? null}
    />
  );
}
