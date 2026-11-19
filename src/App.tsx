/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { AuthProvider } from '@/src/context/AuthContext';
import { ProtectedRoute } from '@/src/components/layout/ProtectedRoute';
import { AppShell } from '@/src/components/layout/AppShell';
import { LoginPage } from '@/src/pages/auth/LoginPage';
import { CommandCenterPage } from '@/src/pages/CommandCenterPage';
import { AdministrationPage } from '@/src/pages/AdministrationPage';
import { ProfilePage } from '@/src/pages/ProfilePage';
import { PlannedModulePage } from '@/src/pages/PlannedModulePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedWorkspace({
  children,
  requiredPermission,
}: {
  children: React.ReactNode;
  requiredPermission?: string;
}) {
  return (
    <ProtectedRoute requiredPermission={requiredPermission}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Google Authentication Login Dashboard */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />
              <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
              <Route path="/reset-password" element={<Navigate to="/login" replace />} />

              {/* Protected Workspace Routes */}
              <Route
                path="/command-center"
                element={
                  <ProtectedWorkspace>
                    <CommandCenterPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedWorkspace>
                    <AdministrationPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedWorkspace>
                    <ProfilePage />
                  </ProtectedWorkspace>
                }
              />

              {/* Phase 2–8 Reserved Module Boundaries */}
              <Route
                path="/live-monitoring"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="live-monitoring" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/cameras"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="cameras" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/video-intelligence"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="video-intelligence" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/identity"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="identity" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/incidents"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="incidents" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/threat-intelligence"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="threat-intelligence" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/ai-analyst"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="ai-analyst" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/investigations"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="investigations" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/research-lab"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="research-lab" />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedWorkspace>
                    <PlannedModulePage moduleId="reports" />
                  </ProtectedWorkspace>
                }
              />

              <Route path="/" element={<Navigate to="/command-center" replace />} />
              <Route path="*" element={<Navigate to="/command-center" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
