import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-shell">
        <Header />
        <main className="page-shell">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
