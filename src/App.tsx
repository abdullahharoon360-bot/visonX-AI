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
import { CamerasPage } from '@/src/pages/CamerasPage';
import { LiveMonitoringPage } from '@/src/pages/LiveMonitoringPage';
import { VideoIntelligencePage } from '@/src/pages/VideoIntelligencePage';
import { IdentityPage } from '@/src/pages/IdentityPage';
import { ThreatIntelligencePage } from '@/src/pages/ThreatIntelligencePage';
import { IncidentsPage } from '@/src/pages/IncidentsPage';
import { AiAnalystPage } from '@/src/pages/AiAnalystPage';
import { InvestigationsPage } from '@/src/pages/InvestigationsPage';
import { ResearchLabPage } from '@/src/pages/ResearchLabPage';
import { ReportsPage } from '@/src/pages/ReportsPage';

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

              {/* Protected Workspace Routes (All Phases 1–8) */}
              <Route
                path="/command-center"
                element={
                  <ProtectedWorkspace>
                    <CommandCenterPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/live-monitoring"
                element={
                  <ProtectedWorkspace>
                    <LiveMonitoringPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/cameras"
                element={
                  <ProtectedWorkspace>
                    <CamerasPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/video-intelligence"
                element={
                  <ProtectedWorkspace>
                    <VideoIntelligencePage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/identity"
                element={
                  <ProtectedWorkspace>
                    <IdentityPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/incidents"
                element={
                  <ProtectedWorkspace>
                    <IncidentsPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/threat-intelligence"
                element={
                  <ProtectedWorkspace>
                    <ThreatIntelligencePage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/ai-analyst"
                element={
                  <ProtectedWorkspace>
                    <AiAnalystPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/investigations"
                element={
                  <ProtectedWorkspace>
                    <InvestigationsPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/research-lab"
                element={
                  <ProtectedWorkspace>
                    <ResearchLabPage />
                  </ProtectedWorkspace>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedWorkspace>
                    <ReportsPage />
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

              <Route path="/" element={<Navigate to="/command-center" replace />} />
              <Route path="*" element={<Navigate to="/command-center" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
