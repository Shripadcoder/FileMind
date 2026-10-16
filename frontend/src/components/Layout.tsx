import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Bot,
  Calendar,
  Files,
  LayoutDashboard,
  Moon,
  Network,
  Search,
  Settings,
  Sun,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/files", label: "My Files", icon: Files },
  { to: "/search", label: "Smart Search", icon: Search },
  { to: "/graph", label: "Knowledge Graph", icon: Network },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/assistant", label: "AI Assistant", icon: Bot },
  { to: "/settings", label: "Settings", icon: Settings },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function Layout() {
  const { dark, toggle } = useTheme();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 p-4 dark:border-slate-800 md:block">
        <div className="mb-6 px-2 text-xl font-bold">FileMind</div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  isActive ? "bg-slate-100 dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"
                }`
              }
            >
              <Icon size={18} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="font-semibold md:hidden">FileMind</div>
          <nav className="flex gap-1 overflow-x-auto md:hidden" aria-label="Primary">
            {NAV.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className="whitespace-nowrap rounded-md px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={toggle}
            className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
            {dark ? "Light" : "Dark"}
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
