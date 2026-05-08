import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from 'lucide-react';

interface EditorDrawerProps {
  mode: 'palette' | 'edit';
  onBackToPalette: () => void;
  paletteContent: React.ReactNode;
  editContent: React.ReactNode | null;
  editActions?: React.ReactNode;
}

export function EditorDrawer({
  mode,
  onBackToPalette,
  paletteContent,
  editContent,
  editActions,
}: EditorDrawerProps) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('rgl-drawer-open');
    return () => {
      document.body.classList.remove('rgl-drawer-open');
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <style>{`
        body.rgl-drawer-open { padding-right: 24rem; }
        @media (max-width: 768px) { body.rgl-drawer-open { padding-right: 0; } }
      `}</style>
      <aside
        className="fixed right-0 top-0 z-50 flex h-screen w-96 flex-col border-l border-border shadow-2xl"
        style={{ backgroundColor: 'var(--rm-bg, #141414)' }}
        role="complementary"
        aria-label="Dashboard editor"
      >
        <header
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
          style={{ backgroundColor: 'var(--rm-bg-elevated, #1e1e1e)' }}
        >
          {mode === 'edit' ? (
            <button
              type="button"
              onClick={onBackToPalette}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-secondary transition-colors hover:border-border-strong hover:text-fg"
            >
              <ChevronLeft className="h-3 w-3" />
              Widgets
            </button>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
              Edit Mode
            </p>
          )}
          {editActions ? (
            <div className="ml-auto flex items-center gap-2">{editActions}</div>
          ) : null}
        </header>

        {/* Content — the child component is responsible for its own internal scroll */}
        <div className="flex min-h-0 flex-1 overflow-hidden p-3">
          {mode === 'edit' && editContent ? editContent : paletteContent}
        </div>
      </aside>
    </>,
    document.body
  );
}
