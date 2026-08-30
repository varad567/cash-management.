import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { initOfflineSync } from './lib/offlineQueue';
import { getOpenRegister } from './lib/shiftService';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ShiftOpen from './pages/ShiftOpen';
import NavShell from './components/NavShell';
import type { ShiftRegister } from './lib/types';

// Route-level code splitting: each page is only fetched when the
// person actually navigates to it, instead of all of them landing in
// one ever-growing initial bundle.
const ShiftClose = lazy(() => import('./pages/ShiftClose'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const HqDashboard = lazy(() => import('./pages/HqDashboard'));
const NewBill = lazy(() => import('./pages/NewBill'));
const CollectPayment = lazy(() => import('./pages/CollectPayment'));
const Admissions = lazy(() => import('./pages/Admissions'));
const Expenses = lazy(() => import('./pages/Expenses'));
const ExpenseApprovals = lazy(() => import('./pages/ExpenseApprovals'));
const CashDeposits = lazy(() => import('./pages/CashDeposits'));
const CustomerCredits = lazy(() => import('./pages/CustomerCredits'));
const Returns = lazy(() => import('./pages/Returns'));
const ReturnsOverview = lazy(() => import('./pages/ReturnsOverview'));
const ShiftHistory = lazy(() => import('./pages/ShiftHistory'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const BillsBrowser = lazy(() => import('./pages/BillsBrowser'));
const AddUser = lazy(() => import('./pages/AddUser'));

function PageFallback() {
  return <div className="p-6 text-sm text-slate-400">Loading…</div>;
}

function Shell() {
  const { appUser, loading, error, passwordRecovery } = useAuth();
  const [register, setRegister] = useState<ShiftRegister | null>(null);
  const [registerLoading, setRegisterLoading] = useState(true);

  useEffect(() => {
    initOfflineSync();
  }, []);

  // HQ and audit roles aren't tied to a till, so they skip shift
  // gating entirely and land on a cross-outlet overview instead of
  // the register-scoped Dashboard (which they have no register for —
  // previously this fell through to an infinite redirect loop).
  const needsShiftGate = appUser && appUser.outlet_id;
  const isHqOrAudit = appUser?.role === 'hq' || appUser?.role === 'audit';
  const canSeeAuditLog = appUser?.role === 'manager' || isHqOrAudit;

  useEffect(() => {
    if (!needsShiftGate) {
      setRegisterLoading(false);
      return;
    }
    getOpenRegister(appUser!.outlet_id!)
      .then(setRegister)
      .finally(() => setRegisterLoading(false));
  }, [needsShiftGate, appUser]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  // Takes priority over everything else — a person mid password-reset
  // shouldn't see the normal login form or app shell at all.
  if (passwordRecovery) {
    return <ResetPassword />;
  }

  if (!appUser) {
    return (
      <>
        {error && (
          <div className="bg-red-100 text-red-800 text-sm text-center py-2 px-4">{error}</div>
        )}
        <Login />
      </>
    );
  }

  if (needsShiftGate) {
    if (registerLoading) {
      return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
    }
    if (!register) {
      return <ShiftOpen onShiftOpened={setRegister} />;
    }
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<NavShell />}>
            <Route
              index
              element={
                isHqOrAudit ? (
                  <HqDashboard />
                ) : register ? (
                  <Dashboard register={register} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            {!isHqOrAudit && <Route path="new-bill" element={<NewBill />} />}
            {!isHqOrAudit && <Route path="collect-payment" element={<CollectPayment />} />}
            {!isHqOrAudit && <Route path="admissions" element={<Admissions />} />}
            {!isHqOrAudit && <Route path="expenses" element={<Expenses />} />}
            {isHqOrAudit && <Route path="expense-approvals" element={<ExpenseApprovals />} />}
            {appUser.role === 'hq' && <Route path="add-user" element={<AddUser />} />}
            {!isHqOrAudit && <Route path="deposits" element={<CashDeposits />} />}
            {!isHqOrAudit && <Route path="customer-credits" element={<CustomerCredits />} />}
            {!isHqOrAudit && <Route path="returns" element={<Returns />} />}
            {isHqOrAudit && <Route path="returns" element={<ReturnsOverview />} />}
            <Route path="bills" element={<BillsBrowser />} />
            <Route path="shift-history" element={<ShiftHistory />} />
            {canSeeAuditLog && <Route path="audit-log" element={<AuditLog />} />}
            {!isHqOrAudit && (
              <Route
                path="close-shift"
                element={
                  register ? (
                    <ShiftClose
                      register={register}
                      onClosed={() => setRegister(null)}
                      onCancel={() => window.history.back()}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
            )}
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
