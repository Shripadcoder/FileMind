import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider } from "./lib/auth";
import Activity from "./pages/Activity";
import Dashboard from "./pages/Dashboard";
import Files from "./pages/Files";
import Goals from "./pages/Goals";
import Login from "./pages/Login";
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
            <Route path="search" element={<PlaceholderPage title="Smart Search" phase="Phase 5" />} />
            <Route path="graph" element={<PlaceholderPage title="Knowledge Graph" phase="Phase 6" />} />
            <Route path="goals" element={<Goals />} />
            <Route path="activity" element={<Activity />} />
            <Route path="calendar" element={<PlaceholderPage title="Calendar" phase="Phase 6" />} />
            <Route path="assistant" element={<PlaceholderPage title="AI Assistant" phase="Phase 5" />} />
            <Route path="settings" element={<PlaceholderPage title="Settings" phase="Phase 5 (AI consent toggle)" />} />
            <Route path="*" element={<PlaceholderPage title="Not found" phase="an existing route" />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
