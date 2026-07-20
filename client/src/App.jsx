import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import CustomerQueue from './pages/CustomerQueue';
import AdminDashboard from './pages/AdminDashboard';
import Home from './pages/Home';
import Monitor from './pages/Monitor';
import Register from './pages/Register';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import StoreSetup from './pages/StoreSetup';
import PlatformReview from './pages/PlatformReview';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/queue/:id" element={<CustomerQueue />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/store/setup" element={<StoreSetup />} />
        <Route path="/platform/admin" element={<PlatformReview />} />
      </Routes>
      <Toaster position="bottom-center" />
    </>
  );
}

export default App;
