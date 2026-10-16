import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import PlaceholderPage from "./pages/PlaceholderPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="files" element={<PlaceholderPage title="My Files" phase="Phase 2" />} />
          <Route path="search" element={<PlaceholderPage title="Smart Search" phase="Phase 5" />} />
          <Route path="graph" element={<PlaceholderPage title="Knowledge Graph" phase="Phase 6" />} />
          <Route path="goals" element={<PlaceholderPage title="Goals" phase="Phase 3" />} />
          <Route path="activity" element={<PlaceholderPage title="Activity" phase="Phase 3" />} />
          <Route path="calendar" element={<PlaceholderPage title="Calendar" phase="Phase 6" />} />
          <Route path="assistant" element={<PlaceholderPage title="AI Assistant" phase="Phase 5" />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" phase="Phase 5 (AI consent toggle)" />} />
          <Route path="*" element={<PlaceholderPage title="Not found" phase="an existing route" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
