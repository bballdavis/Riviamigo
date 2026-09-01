import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, Edit3, Plus } from 'lucide-react';
import { BUILT_IN_THEMES, resolveTheme, type ThemeOverride } from '@riviamigo/themes';
import { queryKeys, themeClient, useAuth } from '@riviamigo/hooks';
import type { ThemeCatalogResponse, ThemePalette, ThemePreferencesResponse, ThemePreferencesV2 } from '@riviamigo/types';
import { Button, Input, Skeleton } from '@riviamigo/ui/primitives';
import { cn } from '@riviamigo/ui/lib/utils';

export function ThemeGallery() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userId = useAuth((state) => state.userId);
  const preferenceKey = queryKeys.themePreferences.forUser(userId ?? 'signed-out');
  const catalogKey = queryKeys.themes.catalog(userId ?? 'signed-out');
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [baseThemeId, setBaseThemeId] = React.useState<ThemePalette>('classic');
  const catalog = useQuery({ queryKey: catalogKey, queryFn: () => themeClient.getCatalog() as Promise<ThemeCatalogResponse>, enabled: !!userId });
  const preference = useQuery({ queryKey: preferenceKey, queryFn: () => themeClient.getPreferences(), enabled: !!userId });

  const selectTheme = useMutation({
    mutationFn: async (selection: ThemePreferencesV2['selection']) => {
      const current = preference.data;
      if (!current?.etag) throw new Error('Appearance preferences are still loading.');
      return themeClient.updatePreferences({ schemaVersion: 2, mode: current.preferences.mode, selection }, current.etag);
    },
    onSuccess: (response: ThemePreferencesResponse) => {
      queryClient.setQueryData(preferenceKey, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });
  const createTheme = useMutation({
    mutationFn: () => themeClient.create(name.trim(), baseThemeId),
    onSuccess: (result: { themeId: string }) => {
      void queryClient.invalidateQueries({ queryKey: catalogKey });
      void navigate({ to: '/settings/themes/$themeId', params: { themeId: result.themeId } });
    },
  });

  const selected = preference.data?.preferences.selection;
  if (catalog.isLoading || preference.isLoading) return <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-44 rounded-xl" /><Skeleton className="h-44 rounded-xl" /></div>;

  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Themes">
      {(['classic', 'rad'] as const).map((themeId) => {
        const theme = BUILT_IN_THEMES[themeId];
        const active = selected?.kind === 'builtin' && selected.themeId === themeId;
        return <ThemeCard key={themeId} name={theme.name} description={themeId === 'classic' ? 'The original Riviamigo visual system.' : 'Warm gold, trail red, and adventure teal.'} colors={theme.series} surface={theme.tokens.dark['bg-page']} panel={theme.tokens.dark['bg-surface']} foreground={theme.tokens.dark['text-primary']} accent={theme.tokens.dark.accent} brandAsset={theme.brandAssets.wordmark.dark} active={active} disabled={selectTheme.isPending} onSelect={() => selectTheme.mutate({ kind: 'builtin', themeId })} />;
      })}
      {(catalog.data?.customThemes ?? []).filter((theme) => theme.publishedRevision !== null).map((theme) => {
        const definition = resolveTheme((theme.publishedDefinition ?? { theme: theme.baseThemeId }) as ThemeOverride);
        const active = selected?.kind === 'custom' && selected.themeId === theme.themeId && selected.revision === theme.publishedRevision;
        return <ThemeCard key={theme.themeId} name={theme.name} description={`Private custom theme · based on ${definition.name}`} colors={definition.series} surface={definition.tokens.dark['bg-page']} panel={definition.tokens.dark['bg-surface']} foreground={definition.tokens.dark['text-primary']} accent={definition.tokens.dark.accent} brandAsset={definition.brandAssets.wordmark.dark} active={active} disabled={selectTheme.isPending} onSelect={() => selectTheme.mutate({ kind: 'custom', themeId: theme.themeId, revision: theme.publishedRevision! })} onEdit={() => void navigate({ to: '/settings/themes/$themeId', params: { themeId: theme.themeId } })} />;
      })}
    </div>

    {creating ? <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
      <Input label="Theme name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
      <label className="grid gap-1.5 text-sm font-medium text-fg-secondary">Start from<select value={baseThemeId} onChange={(event) => setBaseThemeId(event.target.value as ThemePalette)} className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"><option value="classic">Classic</option><option value="rad">RAD</option></select></label>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={!name.trim()} loading={createTheme.isPending} onClick={() => createTheme.mutate()}>Create</Button></div>
      {createTheme.isError ? <p className="text-xs text-status-danger sm:col-span-3" role="alert">Unable to create the theme. Check the name and try again.</p> : null}
    </div> : <Button variant="secondary" className="justify-self-start" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create custom theme</Button>}

    {selectTheme.isError ? <p className="text-xs text-status-danger" role="alert">The theme changed elsewhere or could not be saved. Refresh and try again.</p> : null}
    <p className="text-xs text-fg-tertiary">Custom themes are private to your account. You can keep up to 20.</p>
  </div>;
}

function ThemeCard({ name, description, colors, surface, panel, foreground, accent, brandAsset, active, disabled, onSelect, onEdit }: { name: string; description: string; colors: Record<string, { light: string; dark: string }>; surface: string; panel: string; foreground: string; accent: string; brandAsset: string; active: boolean; disabled: boolean; onSelect: () => void; onEdit?: () => void }) {
  const preview = Object.values(colors).slice(0, 8);
  return <div className={cn('relative overflow-hidden rounded-xl border bg-bg-elevated/30 transition-colors', active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong')}>
    <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onSelect} className="block min-h-40 w-full p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
      <div aria-hidden="true" className="mb-4 overflow-hidden rounded-lg border border-border p-3" style={{ backgroundColor: surface, color: foreground }}>
        <div className="mb-3 flex items-center justify-between gap-3"><img src={brandAsset} alt="" className="h-5 max-w-[8rem] object-contain object-left" /><span className="h-5 w-10 rounded-full" style={{ backgroundColor: accent }} /></div>
        <div className="mb-3 rounded-md p-2 text-[10px] font-medium" style={{ backgroundColor: panel }}>Interface · Charts · Brand</div>
        <div className="flex h-5 overflow-hidden rounded">{preview.map((pair, index) => <span key={index} className="flex-1" style={{ backgroundColor: pair.dark }} />)}</div>
      </div>
      <span className="flex items-center justify-between gap-3"><span><span className="block text-sm font-semibold text-fg">{name}</span><span className="mt-1 block text-xs text-fg-tertiary">{description}</span></span>{active ? <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-fg-on-accent"><Check className="h-4 w-4" /></span> : null}</span>
    </button>
    {onEdit ? <button type="button" onClick={onEdit} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg border border-border bg-bg-surface text-fg-secondary shadow-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Edit ${name}`}><Edit3 className="h-4 w-4" /></button> : null}
  </div>;
}
