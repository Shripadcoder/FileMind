import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bot,
  Calendar,
  Files,
  Folders,
  LayoutDashboard,
  LogOut,
  Moon,
  Network,
  Search,
  Settings,
  Sun,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

const GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/files", label: "My Files", icon: Files },
      { to: "/search", label: "Smart Search", icon: Search },
      { to: "/graph", label: "Knowledge Graph", icon: Network },
    ],
  },
  {
    label: "Productivity",
    items: [
      { to: "/goals", label: "Goals", icon: Target },
      { to: "/activity", label: "Activity", icon: Activity },
      { to: "/calendar", label: "Calendar", icon: Calendar },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/assistant", label: "AI Assistant", icon: Bot },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function BrandMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-card">
      <Folders size={17} strokeWidth={2.25} aria-hidden />
    </span>
  );
}

function SidebarNav() {
  return (
    <nav className="flex flex-col gap-4" aria-label="Primary">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-600 transition-opacity ${
                        isActive ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <Icon size={17} strokeWidth={2.1} aria-hidden className="shrink-0" />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { dark, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const current = ALL_ITEMS.find((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <Link to="/" className="mb-6 flex items-center gap-2.5 px-1">
          <BrandMark />
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight">FileMind</span>
            <span className="block text-[11px] font-medium text-slate-400">Knowledge OS</span>
          </span>
        </Link>
        <div className="fm-scroll min-h-0 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          {user ? (
            <div className="flex items-center gap-2.5 px-1">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
              >
                {(user.display_name || user.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 leading-tight" title={user.email}>
                <span className="block truncate text-sm font-medium">
                  {user.display_name || user.email}
                </span>
                <span className="block truncate text-xs text-slate-400">{user.email}</span>
              </span>
              <button
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="block rounded-lg bg-indigo-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500"
            >
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5 md:px-6">
            <Link to="/" className="flex items-center gap-2 md:hidden" aria-label="FileMind home">
              <BrandMark />
            </Link>
            <p className="hidden truncate text-sm font-semibold text-slate-700 dark:text-slate-200 md:block" aria-live="polite">
              {current?.label ?? "FileMind"}
            </p>
            <nav className="fm-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto md:hidden" aria-label="Primary">
              {ALL_ITEMS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      isActive
                        ? "bg-indigo-600 text-white"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {!user && (
                <Link
                  to="/login"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 md:hidden"
                >
                  Sign in
                </Link>
              )}
              <button
                onClick={toggle}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                title={dark ? "Switch to light theme" : "Switch to dark theme"}
              >
                {dark ? <Sun size={15} /> : <Moon size={15} />}
                <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-6 md:py-7">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-5 md:px-6">
          <p className="border-t border-slate-200 pt-3 text-xs text-slate-400 dark:border-slate-800">
            FileMind · your files, goals, and activity stay on your machine unless you opt into external AI.
          </p>
        </footer>
      </div>
    </div>
  );
}
