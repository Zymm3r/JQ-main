import { Navigate, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Toaster } from 'react-hot-toast';
import CustomerQueue from './pages/CustomerQueue';
import Home from './pages/Home';
import Monitor from './pages/Monitor';
import Register from './pages/Register';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import StoreSetup from './pages/StoreSetup';
import LiffStatus from './pages/LiffStatus';
import MerchantQueues from './pages/MerchantQueues';

const QrManager = lazy(() => import('./pages/QrManager'));
const LiffQueue = lazy(() => import('./pages/LiffQueue'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const PlatformReview = lazy(() => import('./pages/PlatformReview'));
const MerchantPackage = lazy(() => import('./pages/MerchantPackage'));
const MerchantTeam = lazy(() => import('./pages/MerchantTeam'));

function App() {
  return (
    <>
      <Suspense fallback={<div className="card">Loading...</div>}><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/queue/:id" element={<CustomerQueue />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/store" element={<Navigate to="/store/queues" replace />} />
        <Route path="/store/setup" element={<StoreSetup />} />
        <Route path="/store/queues" element={<MerchantQueues />} />
        <Route path="/store/monitor" element={<MerchantQueues monitor />} />
        <Route path="/store/qr" element={<QrManager />} />
        <Route path="/store/usage" element={<MerchantPackage />} />
        <Route path="/store/package" element={<MerchantPackage />} />
        <Route path="/store/team" element={<MerchantTeam />} />
        <Route path="/liff" element={<LiffQueue />} />
        <Route path="/liff/:liffSlug" element={<LiffQueue />} />
        <Route path="/liff/:liffSlug/status/:publicToken" element={<LiffStatus />} />
        <Route path="/platform-admin" element={<PlatformReview />} />
        <Route path="/platform/admin" element={<PlatformReview />} />
      </Routes></Suspense>
      <Toaster position="bottom-center" />
    </>
  );
}

export default App;
