import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  ChevronDown,
  Github,
  LogIn,
  LogOut,
  PanelLeftClose,
  Sparkles,
} from "lucide-react";

type Props = {
  user: User | null;
  repositoryName: string | null;
  repositoryPickerOpen: boolean;
  importing: boolean;
  width: number | null;
  onWidthChange: (width: number) => void;
  repositoryPicker: ReactNode;
  onClose: () => void;
  onRepositoryPickerOpenChange: (open: boolean) => void;
  onLeaveWorkspace: () => void;
  children: ReactNode;
};

export function Sidebar({
  user,
  repositoryName,
  repositoryPickerOpen,
  importing,
  width,
  onWidthChange,
  repositoryPicker,
  onClose,
  onRepositoryPickerOpenChange,
  onLeaveWorkspace,
  children,
}: Props) {
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const minWidth = 180;
  const maxWidth = viewportWidth <= 640
    ? Math.max(minWidth, Math.floor(viewportWidth * 0.84))
    : Math.max(minWidth, Math.min(560, viewportWidth - 300));
  const defaultWidth = viewportWidth <= 640 ? Math.min(290, maxWidth) : viewportWidth <= 850 ? 235 : 264;
  const currentWidth = Math.min(maxWidth, Math.max(minWidth, width ?? defaultWidth));

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  function resize(nextWidth: number) {
    onWidthChange(Math.round(Math.min(maxWidth, Math.max(minWidth, nextWidth))));
  }

  useEffect(() => {
    if (!repositoryPickerOpen || importing) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !workspaceMenuRef.current?.contains(event.target)) {
        onRepositoryPickerOpenChange(false);
      }
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onRepositoryPickerOpenChange(false);
        workspaceButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [repositoryPickerOpen, importing, onRepositoryPickerOpenChange]);

  return (
    <aside className="sidebar" id="workspace-sidebar" style={{ width: currentWidth, flexBasis: currentWidth }}>
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <Sparkles size={16} strokeWidth={2.2} />
        </div>
        <span className="brand-name">locusmind</span>
        <button
          className="icon-button sidebar-toggle"
          onClick={onClose}
          disabled={importing}
          aria-label="Close sidebar"
          title="Close sidebar"
        >
          <PanelLeftClose size={17} />
        </button>
      </div>

      <div className="workspace-picker-wrap" ref={workspaceMenuRef}>
        <button
          ref={workspaceButtonRef}
          className="workspace-picker"
          aria-expanded={repositoryPickerOpen}
          aria-controls="workspace-menu"
          aria-label={repositoryName ? `Selected repository: ${repositoryName}` : "No repository selected"}
          onClick={() => { if (!importing) onRepositoryPickerOpenChange(!repositoryPickerOpen); }}
        >
          <Github size={16} aria-hidden="true" />
          <span className="workspace-repository" title={repositoryName ?? undefined}>
            {repositoryName ?? "No repository selected"}
          </span>
          <ChevronDown size={16} className="muted-icon" />
        </button>
        {repositoryPickerOpen && (
          <div className="workspace-menu" id="workspace-menu">
            {user ? repositoryPicker : (
              <button className="workspace-menu-action" onClick={onLeaveWorkspace}>
                <LogIn size={15} />
                Sign in to choose a repository
              </button>
            )}
          </div>
        )}
      </div>

      {children}

      <div className="sidebar-bottom">
        {!repositoryName && (
          <div className="local-storage-status">
            <span className="status-dot" />
            Local workspace
          </div>
        )}
        <div className="profile-row">
          {user?.photoURL ? (
            <img className="profile-avatar" src={user.photoURL} alt="" />
          ) : (
            <div className="profile-avatar">
              {user?.displayName?.[0] ?? user?.email?.[0] ?? "G"}
            </div>
          )}
          <div className="profile-copy">
            <span className="profile-name">
              {user ? user.displayName || user.email || "GitHub user" : "Guest"}
            </span>
            <span className="profile-role">
              {user ? "Signed in with GitHub" : "Guest workspace"}
            </span>
          </div>
          {user ? (
            <button
              className="icon-button sign-out-control"
              onClick={onLeaveWorkspace}
              aria-label="Sign out"
              title="Sign out"
              disabled={importing}
            >
              <LogOut size={17} />
            </button>
          ) : (
            <button
              className="guest-account-control"
              onClick={onLeaveWorkspace}
            >
              <LogIn size={16} />
              Sign in
            </button>
          )}
        </div>
      </div>
      <div
        className="sidebar-divider"
        role="separator"
        tabIndex={0}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-controls="workspace-sidebar"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={currentWidth}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          resizeStart.current = { x: event.clientX, width: currentWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (resizeStart.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
            resize(resizeStart.current.width + event.clientX - resizeStart.current.x);
          }
        }}
        onPointerUp={() => { resizeStart.current = null; }}
        onPointerCancel={() => { resizeStart.current = null; }}
        onLostPointerCapture={() => { resizeStart.current = null; }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10;
          if (event.key === "ArrowLeft") resize(currentWidth - step);
          else if (event.key === "ArrowRight") resize(currentWidth + step);
          else if (event.key === "Home") resize(minWidth);
          else if (event.key === "End") resize(maxWidth);
          else return;
          event.preventDefault();
        }}
      />
    </aside>
  );
}
