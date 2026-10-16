import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider } from "./lib/auth";
import Activity from "./pages/Activity";
import Assistant from "./pages/Assistant";
import Calendar from "./pages/Calendar";
import Dashboard from "./pages/Dashboard";
import Files from "./pages/Files";
import Goals from "./pages/Goals";
import Graph from "./pages/Graph";
import Login from "./pages/Login";
import Search from "./pages/Search";
import Settings from "./pages/Settings";
import PlaceholderPage from "./pages/PlaceholderPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="login" element={<Login />} />
            <Route path="files" element={<Files />} />
            <Route path="search" element={<Search />} />
            <Route path="graph" element={<Graph />} />
            <Route path="goals" element={<Goals />} />
            <Route path="activity" element={<Activity />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<PlaceholderPage title="Not found" phase="an existing route" />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
