import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import OfflineIndicator from './OfflineIndicator';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${isActive ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

export default function NavShell() {
  const { appUser, signOut } = useAuth();
  const isHqOrAudit = appUser?.role === 'hq' || appUser?.role === 'audit';
  const canSeeAuditLog = appUser?.role === 'manager' || isHqOrAudit;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="font-semibold text-slate-800">Cash Management</h1>
          <p className="text-sm text-slate-500">
            {appUser?.full_name} — {appUser?.role}
          </p>
        </div>
        <button onClick={() => void signOut()} className="text-sm text-slate-600 underline">
          Sign out
        </button>
      </header>
      <nav className="bg-white border-b border-slate-200 px-6 py-2 flex gap-2 overflow-x-auto">
        <NavLink to="/" end className={linkClass}>
          {isHqOrAudit ? 'Overview' : 'Dashboard'}
        </NavLink>
        {!isHqOrAudit && (
          <>
            <NavLink to="/new-bill" className={linkClass}>
              New Bill
            </NavLink>
            <NavLink to="/collect-payment" className={linkClass}>
              Collect Payment
            </NavLink>
            <NavLink to="/admissions" className={linkClass}>
              Patients
            </NavLink>
            <NavLink to="/expenses" className={linkClass}>
              Expenses
            </NavLink>
            <NavLink to="/deposits" className={linkClass}>
              Deposits
            </NavLink>
            <NavLink to="/customer-credits" className={linkClass}>
              Credits
            </NavLink>
            <NavLink to="/returns" className={linkClass}>
              Returns
            </NavLink>
          </>
        )}
        {isHqOrAudit && (
          <NavLink to="/returns" className={linkClass}>
            Returns
          </NavLink>
        )}
        {isHqOrAudit && (
          <NavLink to="/expense-approvals" className={linkClass}>
            Expense Approvals
          </NavLink>
        )}
        {appUser?.role === 'hq' && (
          <NavLink to="/add-user" className={linkClass}>
            Add User
          </NavLink>
        )}
        {appUser?.role === 'hq' && (
          <NavLink to="/staff" className={linkClass}>
            Staff
          </NavLink>
        )}
        {appUser?.role === 'hq' && (
          <NavLink to="/outlets" className={linkClass}>
            Outlets
          </NavLink>
        )}
        {appUser?.role === 'hq' && (
          <NavLink to="/alert-recipients" className={linkClass}>
            Alerts
          </NavLink>
        )}
        <NavLink to="/my-shifts" className={linkClass}>
          My Shifts
        </NavLink>
        {(appUser?.role === 'hq' ||
          appUser?.role === 'audit' ||
          appUser?.role === 'manager') && (
          <NavLink to="/disputes" className={linkClass}>
            Disputes
          </NavLink>
        )}
        <NavLink to="/bills" className={linkClass}>
          Bills
        </NavLink>
        <NavLink to="/shift-history" className={linkClass}>
          Shift History
        </NavLink>
        {canSeeAuditLog && (
          <NavLink to="/audit-log" className={linkClass}>
            Audit Log
          </NavLink>
        )}
        {!isHqOrAudit && (
          <NavLink to="/close-shift" className={linkClass}>
            Close Shift
          </NavLink>
        )}
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
      <OfflineIndicator />
    </div>
  );
}
