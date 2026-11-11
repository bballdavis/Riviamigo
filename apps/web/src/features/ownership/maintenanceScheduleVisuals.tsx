/** Schedule item icons and colors: a category's options, the icon matched to an item's name, and the cycling item palette. */
import type React from 'react';
import {
  AirVent,
  ClipboardCheck,
  Cog,
  Disc,
  Droplet,
  Droplets,
  LifeBuoy,
  RotateCw,
  ShieldPlus,
  ThermometerSnowflake,
  Wind,
  Wrench,
  Zap,
} from 'lucide-react';
import type { OwnershipMaintenanceCategory } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';

export const CATEGORY_OPTIONS: Array<{ value: OwnershipMaintenanceCategory; label: string }> = [
  { value: 'oil', label: 'Oil' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'tires', label: 'Tires' },
  { value: 'service', label: 'Service' },
];

const CATEGORY_ICON: Record<OwnershipMaintenanceCategory, React.ReactElement<{ className?: string }>> = {
  oil: <Droplet />,
  brakes: <Disc />,
  tires: <LifeBuoy />,
  service: <Wrench />,
};

/** An icon for what the item actually is, matched on its name; the category's icon otherwise. */
export function itemIcon(label: string, category: OwnershipMaintenanceCategory): React.ReactElement<{ className?: string }> {
  const name = label.toLowerCase();
  if (/rotat/.test(name)) return <RotateCw />;
  if (/inspect/.test(name)) return <ClipboardCheck />;
  if (/brake fluid/.test(name)) return <Droplets />;
  if (/hepa/.test(name)) return <ShieldPlus />;
  if (/cabin|microfilter/.test(name)) return <Wind />;
  if (/engine air|air filter/.test(name)) return <AirVent />;
  if (/coolant/.test(name)) return <ThermometerSnowflake />;
  if (/spark/.test(name)) return <Zap />;
  if (/gear|transfer|transmission|differential/.test(name)) return <Cog />;
  if (/oil/.test(name)) return <Droplet />;
  if (/pad|rotor|brake/.test(name)) return <Disc />;
  if (/tire/.test(name)) return <LifeBuoy />;
  return CATEGORY_ICON[category];
}

/** Item colors, cycled down the list so neighbouring items never share one. */
export const ITEM_COLORS = [
  CHART_COLORS.sky,
  CHART_COLORS.emerald,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.yellow,
  CHART_COLORS.teal,
  CHART_COLORS.indigo,
  CHART_COLORS.orange,
];
