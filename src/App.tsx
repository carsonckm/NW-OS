/**
 * NW OS — Company Operating System
 * Root Application Component
 */

import React, { useState } from 'react';
import { NWProvider, useNW } from './context/NWContext';
import { Header } from './components/Header';
import { OwnerDashboard } from './views/OwnerDashboard';
import { PMDashboard } from './views/PMDashboard';
import { SiteDashboard } from './views/SiteDashboard';
import { PurchasingDashboard } from './views/PurchasingDashboard';
import { AccountantDashboard } from './views/AccountantDashboard';
import { ProductionManagerDashboard } from './views/ProductionManagerDashboard';
import { ProductionStaffDashboard } from './views/ProductionStaffDashboard';
import { ContractorDashboard } from './views/ContractorDashboard';
import { ClientDashboard } from './views/ClientDashboard';
import { ApprovalsView } from './views/ApprovalsView';
import { PurchasingView } from './views/PurchasingView';
import { FinanceView } from './views/FinanceView';
import { UserManagementView } from './views/UserManagementView';
import { ClientsView } from './views/ClientsView';
import { ContractorsView } from './views/ContractorsView';
import { ProjectsView } from './views/ProjectsView';
import { WorkItemsView } from './views/WorkItemsView';
import { DrawingsView } from './views/DrawingsView';
import { IssuesView } from './views/IssuesView';
import { VariationsView } from './views/VariationsView';
import { KnowledgeBaseView } from './views/KnowledgeBaseView';
import { AuditArchitectureView } from './views/AuditArchitectureView';
import { AIAssistantView } from './views/AIAssistantView';
import { WhatsAppGatewayView } from './views/WhatsAppGatewayView';
import { CommercialView } from './views/CommercialView';
import { ProductionView } from './views/ProductionView';
import { DeliveryView } from './views/DeliveryView';
import { AutomationView } from './views/AutomationView';
import { AIAssistantDrawer } from './components/AIAssistantDrawer';
import { Sparkles, ShieldCheck, Wifi } from 'lucide-react';

const NWAppContent: React.FC = () => {
  const { currentUser, coreDataSync } = useNW();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [showAIAssistant, setShowAIAssistant] = useState(false);

  // Render role-specific dashboard when on 'dashboard' tab
  const renderDashboard = () => {
    switch (currentUser.role) {
      case 'Owner / CEO':
        return <OwnerDashboard onNavigate={(tab) => setActiveTab(tab)} />;
      case 'Project Manager':
      case 'Admin':
        return <PMDashboard onNavigate={(tab) => setActiveTab(tab)} />;
      case 'Site Supervisor':
        return <SiteDashboard />;
      case 'Purchasing':
        return <PurchasingDashboard onNavigate={(tab) => setActiveTab(tab)} />;
      case 'Accountant':
        return <AccountantDashboard onNavigate={(tab) => setActiveTab(tab)} />;
      case 'Production Manager':
        return <ProductionManagerDashboard onNavigate={(tab) => setActiveTab(tab)} />;
      case 'Production Staff':
        return <ProductionStaffDashboard />;
      case 'Contractor':
        return <ContractorDashboard />;
      case 'Client':
        return <ClientDashboard />;
      default:
        return <OwnerDashboard onNavigate={(tab) => setActiveTab(tab)} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-amber-400 selection:text-slate-950">
      {/* Top Header with Role Switcher, Language Switcher, and Nav Tabs */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAssistant={() => setShowAIAssistant(true)}
      />

      {/* Main View Router */}
      <main className="flex-1 pb-16">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'production' && <ProductionView />}
        {activeTab === 'delivery' && <DeliveryView />}
        {activeTab === 'automation' && <AutomationView />}
        {activeTab === 'commercial' && <CommercialView />}
        {activeTab === 'ai-assistant' && <AIAssistantView />}
        {activeTab === 'whatsapp-gateway' && <WhatsAppGatewayView />}
        {activeTab === 'approvals' && <ApprovalsView />}
        {activeTab === 'purchasing' && <PurchasingView />}
        {activeTab === 'finance' && <FinanceView />}
        {activeTab === 'users' && <UserManagementView />}
        {activeTab === 'clients' && (
          <ClientsView onNavigateToWorkItems={() => setActiveTab('work-items')} />
        )}
        {activeTab === 'contractors' && (
          <ContractorsView onNavigateToWorkItems={() => setActiveTab('work-items')} />
        )}
        {activeTab === 'projects' && (
          <ProjectsView
            onSelectProject={() => {}}
            onNavigateToWorkItems={() => setActiveTab('work-items')}
            onNavigateToContractor={() => setActiveTab('contractors')}
          />
        )}
        {activeTab === 'work-items' && <WorkItemsView />}
        {activeTab === 'drawings' && <DrawingsView />}
        {activeTab === 'issues' && <IssuesView />}
        {activeTab === 'variations' && <VariationsView />}
        {activeTab === 'knowledge' && <KnowledgeBaseView />}
        {activeTab === 'audit-logs' && <AuditArchitectureView />}
      </main>

      {/* Floating AI Intelligence Button */}
      <div className="fixed bottom-5 right-5 z-40">
        <button
          onClick={() => setShowAIAssistant(true)}
          className="group flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 px-4 py-3 rounded-full shadow-xl transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none"
        >
          <Sparkles className="w-5 h-5 animate-pulse text-slate-950" />
          <span className="text-xs font-black tracking-wide pr-1">Ask NW OS</span>
        </button>
      </div>

      {/* AI Assistant Drawer */}
      <AIAssistantDrawer
        isOpen={showAIAssistant}
        onClose={() => setShowAIAssistant(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white/90 py-4 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-800">NW OS v1.4</span>
            <span>•</span>
            <span>Malaysian Construction & Carpentry Operating System</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1 text-emerald-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Offline-Ready (PWA)</span>
            </span>
            <span>•</span>
            <span className="text-slate-600 font-medium">Manage By Exception</span>
            {coreDataSync.mode === 'database' && (
              <>
                <span>•</span>
                <span
                  data-testid="core-sync-status"
                  title={coreDataSync.message || coreDataSync.lastSyncedAt}
                  className={coreDataSync.status === 'error' ? 'text-rose-600 font-medium' : 'text-slate-600 font-medium'}
                >
                  Core data: Database ({coreDataSync.status})
                </span>
              </>
            )}
            {coreDataSync.mode === 'local' && coreDataSync.status === 'error' && (
              <>
                <span>•</span>
                <span data-testid="core-sync-status" title={coreDataSync.message} className="text-rose-600 font-medium">
                  Core data: Local (database unavailable)
                </span>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <NWProvider>
      <NWAppContent />
    </NWProvider>
  );
}
