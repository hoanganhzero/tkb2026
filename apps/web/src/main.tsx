import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import App from './App';
import LoginPage from './pages/LoginPage';
import GridPage from './features/grid/GridPage';
import AvailabilityPage from './features/availability/AvailabilityPage';
import RolloverPage from './features/rollover/RolloverPage';
import ImportPage from './features/import/ImportPage';
import DanhMucPage from './features/danhmuc/DanhMucPage';
import PlaceholderPage from './pages/PlaceholderPage';

const router = createBrowserRouter([
  { path: '/dang-nhap', element: <LoginPage /> },
  {
    path: '/app/:truong',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="xep-tkb/demo" replace /> },
      { path: 'xep-tkb/:id', element: <GridPage /> },
      { path: 'rang-buoc/lich-ban', element: <AvailabilityPage /> },
      { path: 'chuyen-tiep', element: <RolloverPage /> },
      { path: 'danh-muc', element: <DanhMucPage /> },
      { path: 'nhap-lieu', element: <ImportPage /> },
      // Các màn hình còn lại theo IA (design spec §4) — dựng theo lộ trình
      { path: '*', element: <PlaceholderPage /> }
    ]
  },
  { path: '*', element: <Navigate to="/dang-nhap" replace /> }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
