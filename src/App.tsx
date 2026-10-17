import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { JumpsProvider } from './context/JumpsContext';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import LoginPage from './pages/LoginPage';
import JumpsPage from './pages/JumpsPage';
import JumpFormPage from './pages/JumpFormPage';
import ImportPage from './pages/ImportPage';
import SharedJumpPage from './pages/SharedJumpPage';
import SharedWithMePage from './pages/SharedWithMePage';

const StatsPage = lazy(() => import('./pages/StatsPage'));

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner fullScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return (
    <JumpsProvider>
      <Outlet />
    </JumpsProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<JumpsPage />} />
            <Route path="jumps/new" element={<JumpFormPage />} />
            <Route path="jumps/:id" element={<JumpFormPage />} />
            <Route
              path="stats"
              element={
                <Suspense fallback={<Spinner />}>
                  <StatsPage />
                </Suspense>
              }
            />
            <Route path="import" element={<ImportPage />} />
            <Route path="shared" element={<SharedWithMePage />} />
            <Route path="shared/:ownerUid/:jumpId" element={<SharedJumpPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
