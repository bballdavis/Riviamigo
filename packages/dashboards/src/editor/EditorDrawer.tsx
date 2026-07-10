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
        html:has(body.rgl-drawer-open) { scrollbar-gutter: stable; }
        body.rgl-drawer-open { overflow-x: hidden; }
        body.rgl-drawer-open .rm-app-main { padding-right: 24rem; }
        body.rgl-drawer-open .rm-app-content {
          max-width: none;
          margin-left: 0;
          margin-right: 0;
        }
        .rgl-editor-drawer {
          top: 0;
          right: 0;
          bottom: 0;
        }
        @media (max-width: 768px) {
          html:has(body.rgl-drawer-open) { scrollbar-gutter: unset; }
          body.rgl-drawer-open { overflow-x: unset; }
          body.rgl-drawer-open .rm-app-main {
            padding-right: 0;
            padding-bottom: min(42vh, 22rem);
          }
          .rgl-editor-drawer {
            top: auto;
            left: 0;
            width: 100%;
            max-width: none;
            height: min(42vh, 22rem);
            border-top: 1px solid var(--rm-border-default);
            border-left: 0;
          }
        }
      `}</style>
      <aside
        className="rgl-editor-drawer fixed z-50 flex w-96 max-w-[calc(100vw-1rem)] flex-col border-l border-border shadow-2xl"
        style={{ backgroundColor: 'var(--rm-bg-page)' }}
        role="complementary"
        aria-label="Dashboard editor"
        onWheel={(event) => event.stopPropagation()}
      >
        <header
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
          style={{ backgroundColor: 'var(--rm-bg-elevated)' }}
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {mode === 'edit' && editContent ? editContent : paletteContent}
        </div>
      </aside>
    </>,
    document.body
  );
}
