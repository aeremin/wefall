import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth, useRoles } from './context/AuthContext';
import { hasAnyRole, type Role } from './lib/roles';
import { JumpsProvider } from './context/JumpsContext';
import Layout from './components/Layout';
import PublicLayout from './components/PublicLayout';
import Spinner from './components/Spinner';
import LoginPage from './pages/LoginPage';
import JumpsPage from './pages/JumpsPage';
import JumpFormPage from './pages/JumpFormPage';
import ImportPage from './pages/ImportPage';
import SharedJumpPage from './pages/SharedJumpPage';
import SharedWithMePage from './pages/SharedWithMePage';
import PublicJumpPage from './pages/PublicJumpPage';

const StatsPage = lazy(() => import('./pages/StatsPage'));
const FlySightPage = lazy(() => import('./pages/FlySightPage'));
const BluetoothExplorerPage = lazy(() => import('./pages/BluetoothExplorerPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const TrackPage = lazy(() => import('./pages/TrackPage'));

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

/** Sends users without one of `roles` (admins always have access) back to the logbook. */
function RequireRole({ roles }: { roles: Role[] }) {
  const userRoles = useRoles();
  return hasAnyRole(userRoles, roles) ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<PublicLayout />}>
          <Route path="link/:token" element={<PublicJumpPage />} />
          <Route
            path="link/:token/track/:attachmentId"
            element={
              <Suspense fallback={<Spinner />}>
                <TrackPage />
              </Suspense>
            }
          />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<JumpsPage />} />
            <Route path="jumps/new" element={<JumpFormPage />} />
            <Route path="jumps/:id" element={<JumpFormPage />} />
            <Route
              path="jumps/:id/track/:attachmentId"
              element={
                <Suspense fallback={<Spinner />}>
                  <TrackPage />
                </Suspense>
              }
            />
            <Route
              path="stats"
              element={
                <Suspense fallback={<Spinner />}>
                  <StatsPage />
                </Suspense>
              }
            />
            <Route path="import" element={<ImportPage />} />
            <Route
              path="flysight"
              element={
                <Suspense fallback={<Spinner />}>
                  <FlySightPage />
                </Suspense>
              }
            />
            <Route element={<RequireRole roles={['beta']} />}>
              <Route
                path="bluetooth"
                element={
                  <Suspense fallback={<Spinner />}>
                    <BluetoothExplorerPage />
                  </Suspense>
                }
              />
            </Route>
            <Route element={<RequireRole roles={['admin']} />}>
              <Route
                path="admin"
                element={
                  <Suspense fallback={<Spinner />}>
                    <AdminPage />
                  </Suspense>
                }
              />
            </Route>
            <Route path="shared" element={<SharedWithMePage />} />
            <Route path="shared/:ownerUid/:jumpId" element={<SharedJumpPage />} />
            <Route
              path="shared/:ownerUid/:jumpId/track/:attachmentId"
              element={
                <Suspense fallback={<Spinner />}>
                  <TrackPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
