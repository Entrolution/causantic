import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { Overview } from './pages/Overview';
import { GraphExplorer } from './pages/GraphExplorer';
import { Clusters } from './pages/Clusters';
import { SearchPage } from './pages/SearchPage';
import { Projects } from './pages/Projects';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Overview />} />
          <Route path="/graph" element={<GraphExplorer />} />
          <Route path="/clusters" element={<Clusters />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/projects" element={<Projects />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
