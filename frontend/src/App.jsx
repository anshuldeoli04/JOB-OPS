import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/layout/Layout';
import AuthLayout from './components/layout/AuthLayout';
import ToastViewport from './components/ui/ToastViewport';
import LoadingBar from './components/ui/LoadingBar';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Applications = lazy(() => import('./pages/Applications'));
const Scanner = lazy(() => import('./pages/Scanner'));
const Evaluate = lazy(() => import('./pages/Evaluate'));
const ResumeBuilder = lazy(() => import('./pages/ResumeBuilder'));
const Operations = lazy(() => import('./pages/Operations'));
const Settings = lazy(() => import('./pages/Settings'));
const Setup = lazy(() => import('./pages/Setup'));
import Login from './pages/Login';
import Signup from './pages/Signup';
import { useAppStore } from './store/useAppStore';

function ProtectedRoute({ children }) {
  const hydrated = useAppStore((state) => state.hydrated);
  const session = useAppStore((state) => state.session);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const setupStatus = useAppStore((state) => state.setupStatus);
  const location = useLocation();

  useEffect(() => {
    if (!hydrated) {
      bootstrap();
    }
  }, [bootstrap, hydrated]);

  if (!hydrated) {
    return <div className="page-loader">Loading workspace...</div>;
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />;
  }

  if (location.pathname !== '/setup' && setupStatus && !setupStatus.configured) {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

function AppShell() {
  const location = useLocation();
  const clearShortcutFocus = useAppStore((state) => state.clearShortcutFocus);

  useEffect(() => {
    clearShortcutFocus();
  }, [location.pathname, clearShortcutFocus]);

  return (
    <>
      <LoadingBar />
      <Suspense fallback={<div className="page-loader">Loading page...</div>}>
        <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<Login />} />
          <Route path="/auth/signup" element={<Signup />} />
        </Route>

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="setup" element={<Setup />} />
          <Route index element={<Dashboard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="scanner" element={<Scanner />} />
          <Route path="evaluate" element={<Evaluate />} />
          <Route path="resume" element={<ResumeBuilder />} />
          <Route path="operations" element={<Operations />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        </Routes>
      </Suspense>
      <ToastViewport />
    </>
  );
}

export default function App() {
  return <AppShell />;
}
