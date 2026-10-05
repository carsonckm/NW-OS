/**
 * NW OS — Project Command Center + PM Dashboard
 *
 * Single-screen operational command center for Project Managers and Owners:
 * 1. Project Master Header (Project #, Name, Client, Site, Dates, Value, Status, Risk)
 * 2. Project Health Header (6 summary cards: Progress, Schedule, Production, Delivery, Issues, Financials)
 * 3. Visual Project Timeline (Contract/LA -> Pre-Start -> Production -> Delivery -> Installation -> Completion)
 * 4. Work Package Overview (Carpentry, Electrical, Glass, Metal, Painting, Ceiling, etc. with risk & delay badges)
 * 5. Work Item Status Matrix (15-stage filterable counts with instant work item list drill-down)
 * 6. Today's Actions (Real-time operational queue with priority, responsible person, due times, and action buttons)
 * 7. Project Issues Panel (Severity breakdown, complete lifecycle workflow, escalation targets)
 * 8. Drawing / Revision Alerts (Production impact checks, dimension changes, conflict detection)
 * 9. Production Status Pipeline (10-stage manufacturing flow with bottleneck highlights)
 * 10. Site Installation & Delivery Tracker (Logistics schedule, loading bay passes, site installation status)
 * 11. Commercial & Variation Overview (Permission-protected financial health)
 * 12. AI Project Briefing & Risk Radar (One-click Gemini intelligence briefing for PM & Owner)
 */

import React, { useState, useMemo } from 'react';
import { useNW } from '../context/NWContext';
import { navigateTo } from '../services/navigation';
import { ProjectServerOverview } from './ServerOverview';
import {
  Project,
  WorkPackage,
  WorkItem,
  WorkItemStatus,
  ProjectStatus,
  RiskStatus,
  Issue,
} from '../types';
import { canViewProjectFinancials, hasPermission } from '../utils/permissions';
import { useServerFinancials } from '../services/serverFinancials';
import { WorkPackageDetailModal } from './WorkPackageDetailModal';
import { WorkItemDetailModal } from './WorkItemDetailModal';
import { IssueModal } from './IssueModal';
import { QCModal } from './QCModal';
import { DeliveryModal } from './DeliveryModal';
import { NewWorkPackageModal } from './NewWorkPackageModal';
import { NewWorkItemModal } from './NewWorkItemModal';
import {
  Building2,
  Calendar,
  Clock,
  MapPin,
  User,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Truck,
  Layers,
  Wrench,
  FileText,
  DollarSign,
  TrendingUp,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Filter,
  Search,
  Plus,
  Lock,
  Eye,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  Factory,
  Boxes,
  HelpCircle,
  Send,
  SlidersHorizontal,
} from 'lucide-react';

interface ProjectCommandCenterProps {
  projectId?: string;
  onBackToPortfolio?: () => void;
  onNavigateToTab?: (tab: string) => void;
}

export const ProjectCommandCenter: React.FC<ProjectCommandCenterProps> = ({
  projectId,
  onBackToPortfolio,
  onNavigateToTab: onNavigateToTabProp,
}) => {
  const {
    currentUser,
    projects,
    userProjects,
    clients,
    contractors,
    workPackages,
    workItems,
    issues,
    drawings,
    variations,
    selectedProjectId,
    setSelectedProjectId,
    updateProject,
    updateWorkItemStatus,
    resolveIssue,
    escalateIssue,
    approveVariation,
    coreDataSync,
  } = useNW();

  // Active project resolution
  const targetId = projectId || selectedProjectId;
  const project =
    projects.find((p) => p.id === targetId) ||
    projects[0];
  // Workflow links always work: the host can override, otherwise open the app tab for this project.
  const onNavigateToTab = onNavigateToTabProp ?? ((tab: string) => navigateTo(tab, project?.id));
  const isStaff = currentUser.role !== 'Client' && currentUser.role !== 'Contractor';

  // Permissions
  const canSeeFinancials = canViewProjectFinancials(currentUser);
  const serverFinancials = useServerFinancials(canSeeFinancials ? project?.id : undefined, coreDataSync);
  const canEditProject =
    currentUser.role === 'Owner / CEO' ||
    currentUser.role === 'Admin' ||
    (currentUser.role === 'Project Manager' && project?.project_manager_id === currentUser.id);

  // Modals state
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [qcWorkItem, setQcWorkItem] = useState<WorkItem | null>(null);
  const [deliveryModalItem, setDeliveryModalItem] = useState<WorkItem | null>(null);
  const [deliveryModalMode, setDeliveryModalMode] = useState<'schedule' | 'receive' | 'install'>('schedule');
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueTargetWorkItemId, setIssueTargetWorkItemId] = useState<string | undefined>(undefined);
  const [editingIssue, setEditingIssue] = useState<Issue | undefined>(undefined);
  const [showNewPackageModal, setShowNewPackageModal] = useState(false);
  const [showNewItemModal, setShowNewItemModal] = useState(false);

  // Interactive filtering state
  const [statusFilter, setStatusFilter] = useState<WorkItemStatus | 'ALL'>('ALL');
  const [tradeFilter, setTradeFilter] = useState<string>('ALL');
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [issuePriorityFilter, setIssuePriorityFilter] = useState<'ALL' | 'Critical' | 'High' | 'Medium' | 'Low'>('ALL');
  const [activeSection, setActiveSection] = useState<'ALL' | 'ACTIONS' | 'TIMELINE' | 'PACKAGES' | 'ITEMS' | 'PRODUCTION' | 'ISSUES' | 'DRAWINGS' | 'FINANCE'>('ALL');

  // AI Briefing Modal state
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [briefingData, setBriefingData] = useState<any | null>(null);
  const [showBriefingModal, setShowBriefingModal] = useState(false);

  // Status & Risk editing
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isEditingRisk, setIsEditingRisk] = useState(false);

  // Owner Exception Mode toggle (for Owner / CEO)
  const [ownerExceptionMode, setOwnerExceptionMode] = useState(currentUser.role === 'Owner / CEO');

  if (!project) {
    return (
      <div className="max-w-7xl mx-auto p-12 text-center text-slate-500">
        <Building2 className="w-12 h-12 mx-auto text-slate-400 mb-3" />
        <p className="font-semibold text-lg text-slate-800">No project selected</p>
        <p className="text-sm">Please select a project from the portfolio.</p>
        {onBackToPortfolio && (
          <button
            onClick={onBackToPortfolio}
            className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
          >
            ← View All Projects
          </button>
        )}
      </div>
    );
  }

  // Related Entities for this Project
  const client = clients.find((c) => c.id === project.client_id);
  const projWorkPackages = workPackages.filter((wp) => wp.project_id === project.id);
  const projWorkItems = workItems.filter((wi) => wi.project_id === project.id);
  const projIssues = issues.filter((i) => i.project_id === project.id);
  const projDrawings = drawings.filter((d) => d.project_id === project.id);
  const projVariations = variations.filter((v) => v.project_id === project.id);

  // Calculate schedule health (days remaining / overdue)
  const today = new Date('2026-09-26T00:00:00Z');
  const endDate = new Date(project.end_date);
  const diffTime = endDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const isOverdue = daysRemaining < 0;

  // Calculate Production progress %
  const prodWeights: Record<string, number> = {
    'Not Started': 0,
    'Material Required': 10,
    'Material Ready': 20,
    'Cutting': 35,
    'CNC': 50,
    'Edge Banding': 65,
    'Assembly': 80,
    'Finishing': 90,
    'QC': 95,
    'Packing': 98,
    'Ready for Delivery': 100,
  };
  const totalItems = projWorkItems.length || 1;
  const productionSum = projWorkItems.reduce((acc, item) => {
    return acc + (prodWeights[item.production_status] ?? (item.progress_percent || 0));
  }, 0);
  const productionPercent = Math.min(100, Math.round(productionSum / totalItems));

  // Upcoming deliveries count
  const upcomingDeliveries = projWorkItems.filter(
    (w) =>
      w.delivery_status === 'Scheduled' ||
      w.delivery_status === 'Loading' ||
      w.delivery_status === 'In Transit' ||
      w.status === 'Ready for Delivery'
  );

  // Issues counts
  const openIssues = projIssues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed');
  const criticalIssues = openIssues.filter((i) => i.priority === 'Critical');

  // Financial summary
  // Official contract figures come from the server in database mode (serverFinancials); the
  // local sums below are only a preview (demo mode, or until the server answers).
  const APPROVED_VO = ['Approved', 'Implemented', 'Closed'];
  const approvedVariations = projVariations.filter((v) => APPROVED_VO.includes(v.status));
  const approvedVariationsTotal =
    serverFinancials?.approved_variations_total ?? approvedVariations.reduce((sum, v) => sum + (v.client_amount || 0), 0);
  const approvedVariationsCount = serverFinancials?.approved_variations_count ?? approvedVariations.length;
  const pendingVariationsTotal =
    serverFinancials?.pending_variations_total ??
    projVariations
      .filter((v) => v.status === 'Identified' || v.status === 'Costing' || v.status === 'Internal Approval' || v.status === 'Client Approval')
      .reduce((sum, v) => sum + (v.client_amount || 0), 0);
  const baseContractValue = serverFinancials?.original_contract_value ?? project.contract_value;
  const totalRevisedContract = serverFinancials?.current_contract_value ?? baseContractValue + approvedVariationsTotal;

  // 15 Work Item Status matrix counts
  const STATUS_LIST: WorkItemStatus[] = [
    'Draft',
    'Assigned',
    'Contractor Confirmed',
    'In Progress',
    'Ready for QC',
    'QC Failed',
    'QC Passed',
    'Ready for Delivery',
    'Delivered',
    'Installation In Progress',
    'Installation QC',
    'Completed',
    'Blocked',
    'On Hold',
  ];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STATUS_LIST.forEach((st) => {
      counts[st] = projWorkItems.filter((item) => item.status === st).length;
    });
    return counts;
  }, [projWorkItems]);

  // Filtered work items
  const filteredWorkItems = useMemo(() => {
    return projWorkItems.filter((item) => {
      const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;
      const wp = projWorkPackages.find((p) => p.id === item.work_package_id);
      const matchTrade = tradeFilter === 'ALL' || wp?.category === tradeFilter || wp?.trade === tradeFilter;
      const matchSearch =
        !itemSearchQuery ||
        item.item_code.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
        item.location.toLowerCase().includes(itemSearchQuery.toLowerCase());
      return matchStatus && matchTrade && matchSearch;
    });
  }, [projWorkItems, statusFilter, tradeFilter, itemSearchQuery, projWorkPackages]);

  // Today's Action Items generation
  const todayActions = useMemo(() => {
    const actions: Array<{
      id: string;
      priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      category: string;
      title: string;
      refCode: string;
      responsible: string;
      dueTime: string;
      actionLabel: string;
      type: 'qc' | 'delivery' | 'drawing' | 'issue' | 'variation' | 'work_item';
      payload: any;
    }> = [];

    // 1. QC inspection required
    projWorkItems
      .filter((w) => w.status === 'Ready for QC' || w.production_status === 'QC')
      .forEach((item) => {
        actions.push({
          id: `today-qc-${item.id}`,
          priority: 'HIGH',
          category: 'QC Inspection',
          title: `Inspect completed fabrication: ${item.description}`,
          refCode: item.item_code,
          responsible: 'Site Supervisor / PM',
          dueTime: 'Today 11:30 AM',
          actionLabel: 'Inspect QC',
          type: 'qc',
          payload: item,
        });
      });

    // 2. Deliveries scheduled today
    projWorkItems
      .filter((w) => w.status === 'Ready for Delivery' || w.delivery_status === 'Scheduled')
      .forEach((item) => {
        actions.push({
          id: `today-del-${item.id}`,
          priority: 'HIGH',
          category: 'Delivery Dispatch',
          title: `Gate clearance & unloading: ${item.description}`,
          refCode: item.item_code,
          responsible: 'Site Supervisor Suresh',
          dueTime: item.scheduled_delivery_time || 'Today 02:00 PM',
          actionLabel: 'Confirm Delivery',
          type: 'delivery',
          payload: item,
        });
      });

    // 3. Critical & High Issues requiring decision
    projIssues
      .filter((i) => i.status !== 'Resolved' && i.status !== 'Closed')
      .forEach((issue) => {
        actions.push({
          id: `today-issue-${issue.id}`,
          priority: issue.priority === 'Critical' ? 'CRITICAL' : issue.priority === 'High' ? 'HIGH' : 'MEDIUM',
          category: 'Issue Decision',
          title: issue.title,
          refCode: issue.id,
          responsible: issue.assigned_to || 'Project Manager Marcus',
          dueTime: issue.priority === 'Critical' ? 'URGENT — Today' : 'Today 04:00 PM',
          actionLabel: 'Resolve / Action',
          type: 'issue',
          payload: issue,
        });
      });

    // 4. Drawing revision alerts / reviews
    projDrawings.forEach((drawing) => {
      drawing.revisions.forEach((rev) => {
        if (rev.approved_status === 'Pending Review' || rev.approved_status === 'Review' || rev.approved_status === 'Internal Review' || rev.approved_status === 'Draft') {
          actions.push({
            id: `today-draw-${rev.id}`,
            priority: 'HIGH',
            category: 'Drawing Review',
            title: `${drawing.drawing_number} ${rev.revision}: ${rev.title}`,
            refCode: drawing.drawing_number,
            responsible: 'Project Manager Marcus',
            dueTime: 'Today 05:00 PM',
            actionLabel: 'Review Drawing',
            type: 'drawing',
            payload: { drawing, revision: rev },
          });
        }
      });
    });

    // 5. Variations awaiting approval
    projVariations
      .filter((v) => v.status === 'Internal Approval' || v.status === 'Client Approval')
      .forEach((vo) => {
        actions.push({
          id: `today-vo-${vo.id}`,
          priority: 'CRITICAL',
          category: 'Variation Approval',
          title: `${vo.variation_number}: ${vo.title} (RM ${(vo.client_amount || 0).toLocaleString()})`,
          refCode: vo.variation_number,
          responsible: vo.status === 'Internal Approval' ? "Dato' Nicholas Wong (Owner)" : 'Client Michelle Tan',
          dueTime: 'End of Day',
          actionLabel: 'Review VO',
          type: 'variation',
          payload: vo,
        });
      });

    // Sort: CRITICAL first, then HIGH, then MEDIUM, then LOW
    const pOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return actions.sort((a, b) => pOrder[a.priority] - pOrder[b.priority]);
  }, [projWorkItems, projIssues, projDrawings, projVariations]);

  // Drawing Alerts extraction
  const drawingAlerts = useMemo(() => {
    const alerts: Array<{
      id: string;
      drawingNumber: string;
      revision: string;
      previousSpec: string;
      newSpec: string;
      affectedItemCode: string;
      affectedItemDescription: string;
      productionStage: string;
      statusText: string;
      statusLevel: 'POSSIBLE' | 'CONFIRMED' | 'AFTER_DELIVERY' | 'NORMAL';
      suggestedAction: string;
    }> = [];

    // Check specific items with revision_impact_alert
    projWorkItems.forEach((item) => {
      if (item.revision_impact_alert) {
        alerts.push({
          id: `alert-${item.id}`,
          drawingNumber: item.drawing_id === 'draw-1' ? 'A-103' : 'A-104',
          revision: item.revision_impact_alert.to_revision || 'Rev 4',
          previousSpec: '2400mm L × 900mm D (18mm Marine Plywood core)',
          newSpec: '2300mm L × 900mm D (Reduced 100mm due to mall wall opening)',
          affectedItemCode: item.item_code,
          affectedItemDescription: item.description,
          productionStage: item.production_status,
          statusText: item.revision_impact_alert.level || 'PRODUCTION IMPACT POSSIBLE',
          statusLevel: 'POSSIBLE',
          suggestedAction: 'Execute 100mm plinth scribing on Module B per NW Standard #001 instead of scrapping cut panels.',
        });
      }
    });

    // Default Malaysian joinery showcase alert if none detected
    if (alerts.length === 0) {
      alerts.push({
        id: 'default-alert-1',
        drawingNumber: 'A-103',
        revision: 'Rev 4',
        previousSpec: '2400mm (Module A: 1200mm + Module B: 1200mm)',
        newSpec: '2300mm (Mall column tolerance reduction of 100mm)',
        affectedItemCode: 'CAR-003',
        affectedItemDescription: 'Checkout Counter #03 (Main Retail Cashier)',
        productionStage: 'Assembly',
        statusText: 'PRODUCTION IMPACT POSSIBLE',
        statusLevel: 'POSSIBLE',
        suggestedAction: 'Review Revision & apply concealed 100mm scribing panel to absorb mall masonry deviation.',
      });
    }

    return alerts;
  }, [projWorkItems]);

  // Production Stage Pipeline counts
  const PROD_STAGES = [
    { key: 'Material Required', label: 'Material Required' },
    { key: 'Material Ready', label: 'Material Ready' },
    { key: 'Cutting', label: 'Cutting' },
    { key: 'CNC', label: 'CNC' },
    { key: 'Edge Banding', label: 'Edge Banding' },
    { key: 'Assembly', label: 'Assembly' },
    { key: 'Finishing', label: 'Finishing' },
    { key: 'QC', label: 'QC Pass' },
    { key: 'Packing', label: 'Packing' },
    { key: 'Ready for Delivery', label: 'Ready to Deliver' },
  ];

  const prodStageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    PROD_STAGES.forEach((stage) => {
      counts[stage.key] = projWorkItems.filter((w) => w.production_status === stage.key).length;
    });
    return counts;
  }, [projWorkItems]);

  // Handle AI Project Briefing generation
  const handleGenerateBriefing = async () => {
    setIsGeneratingBriefing(true);
    setShowBriefingModal(true);
    try {
      const response = await fetch('/api/ai/project-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          workPackages: projWorkPackages,
          workItems: projWorkItems,
          issues: projIssues,
          variations: projVariations,
          drawings: projDrawings,
          userRole: currentUser.role,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setBriefingData(data);
      } else {
        throw new Error('Briefing failed');
      }
    } catch {
      // Fallback
      setBriefingData({
        executive_summary: `${project.project_name} is running at ${project.progress_percent}% progress. Handover is set for ${project.end_date} (${daysRemaining} days remaining). Joinery and site coordination require immediate PM oversight.`,
        handover_projection: `${daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Overdue'}. High probability of on-time delivery if CAR-003 scribing solution is confirmed today.`,
        critical_path_bottlenecks: [
          'CAR-003 Checkout Counter: 100mm site dimension conflict. Carcass currently held at factory assembly.',
          'Pavilion Mall Service Lift: 2200mm height limit requires split-module delivery.',
          'VO-001 Corian upgrade awaiting formal signature.',
        ],
        pm_action_checklist: [
          {
            task: 'Instruct Hock Seng Carpentry to scribe Module B plinth by 100mm without re-ordering plywood.',
            priority: 'CRITICAL',
            reason: 'Saves 7 days and RM 14,500.',
            owner_needed: false,
          },
          {
            task: 'Confirm Pavilion Mall security loading bay permit for tomorrow 09:30 AM arrival.',
            priority: 'HIGH',
            reason: 'Mall security enforces strict delivery windows.',
            owner_needed: false,
          },
          {
            task: 'Complete pre-ceiling inspection on ELE-002 wiring raceway.',
            priority: 'MEDIUM',
            reason: 'Drywall team begins boarding tomorrow afternoon.',
            owner_needed: false,
          },
        ],
        owner_escalations_needed: [
          "Dato' Nicholas Wong executive signature needed for VO-001 (Corian Solid Surface upgrade: RM 18,500).",
        ],
        production_health: 'Factory running at 74% throughput across carpentry packages.',
        financial_risk_summary: `Contract Value: RM ${project.contract_value.toLocaleString()}. Variations: RM ${approvedVariationsTotal.toLocaleString()}.`,
      });
    } finally {
      setIsGeneratingBriefing(false);
    }
  };

  const getStatusColor = (status: ProjectStatus) => {
    switch (status) {
      case 'Awarded':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Pre-Start':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-300';
      case 'Practical Completion':
        return 'bg-teal-50 text-teal-700 border-teal-300';
      case 'Completed':
        return 'bg-slate-100 text-slate-800 border-slate-300 font-bold';
      case 'On Hold':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Closed':
        return 'bg-slate-200 text-slate-600 border-slate-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getRiskColor = (risk: RiskStatus) => {
    switch (risk) {
      case 'On Track':
        return 'bg-emerald-500 text-white border-emerald-600';
      case 'Attention':
        return 'bg-amber-500 text-slate-950 border-amber-600';
      case 'At Risk':
        return 'bg-orange-600 text-white border-orange-700';
      case 'Critical':
        return 'bg-rose-600 text-white border-rose-700 animate-pulse';
      default:
        return 'bg-slate-500 text-white border-slate-600';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Top Navigation & Portfolio Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          {onBackToPortfolio && (
            <button
              onClick={onBackToPortfolio}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Return to Projects Portfolio"
            >
              <span>← All Projects</span>
            </button>
          )}

          {/* Quick Project Switcher Dropdown */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider hidden sm:inline">
              Active Project:
            </span>
            <select
              value={project.id}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
              }}
              className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs max-w-[280px] truncate"
            >
              {(userProjects.length > 0 ? userProjects : projects).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.project_name.split('—')[0]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Global Command Center Controls */}
        <div className="flex items-center space-x-2">
          {/* Owner Exception Mode Toggle (for Owner / CEO) */}
          {currentUser.role === 'Owner / CEO' && (
            <button
              onClick={() => setOwnerExceptionMode(!ownerExceptionMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-2xs border ${
                ownerExceptionMode
                  ? 'bg-amber-500 text-slate-950 border-amber-600 ring-2 ring-amber-400/40'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Filter to high-level executive exceptions and pending approvals"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Owner Exception Radar</span>
              {ownerExceptionMode && (
                <span className="w-2 h-2 rounded-full bg-slate-950 animate-ping ml-1" />
              )}
            </button>
          )}

          {/* AI Project Briefing Button */}
          <button
            onClick={handleGenerateBriefing}
            className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2 transition-all hover:scale-[1.02] cursor-pointer"
            id="btn-ai-project-briefing"
          >
            <Sparkles className="w-4 h-4 text-slate-950 fill-current animate-pulse" />
            <span>AI Project Briefing</span>
          </button>
        </div>
      </div>

      {/* 1. PROJECT MASTER HEADER */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-2.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200">
                {project.project_number}
              </span>

              {/* Project Status Dropdown */}
              <div className="relative">
                <button
                  disabled={!canEditProject}
                  onClick={() => setIsEditingStatus(!isEditingStatus)}
                  className={`px-2.5 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-colors ${getStatusColor(
                    project.project_status
                  )} ${canEditProject ? 'cursor-pointer hover:opacity-85' : 'cursor-default'}`}
                >
                  <span>{project.project_status}</span>
                  {canEditProject && <ChevronDown className="w-3 h-3 text-slate-500" />}
                </button>

                {isEditingStatus && (
                  <div className="absolute left-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-30">
                    {[
                      'Awarded',
                      'Pre-Start',
                      'Active',
                      'Practical Completion',
                      'Completed',
                      'Closed',
                      'On Hold',
                    ].map((st) => (
                      <button
                        key={st}
                        onClick={() => {
                          updateProject(project.id, { project_status: st as ProjectStatus });
                          setIsEditingStatus(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between ${
                          project.project_status === st ? 'font-bold text-amber-700 bg-amber-50/50' : 'text-slate-700'
                        }`}
                      >
                        <span>{st}</span>
                        {project.project_status === st && <Check className="w-3.5 h-3.5 text-amber-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Risk Status Dropdown */}
              <div className="relative">
                <button
                  disabled={!canEditProject || coreDataSync.mode === 'database'}
                  title={coreDataSync.mode === 'database' ? `Computed by the risk engine${project.risk_reason ? `: ${project.risk_reason}` : ''}` : undefined}
                  onClick={() => setIsEditingRisk(!isEditingRisk)}
                  className={`px-2.5 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider flex items-center space-x-1.5 shadow-2xs ${getRiskColor(
                    project.risk_status || (project.is_at_risk ? 'At Risk' : 'On Track')
                  )} ${canEditProject ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>{project.risk_status || (project.is_at_risk ? 'At Risk' : 'On Track')}</span>
                  {canEditProject && coreDataSync.mode !== 'database' && <ChevronDown className="w-3 h-3" />}
                </button>

                {isEditingRisk && (
                  <div className="absolute left-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-30">
                    {['On Track', 'Attention', 'At Risk', 'Critical'].map((rk) => (
                      <button
                        key={rk}
                        onClick={() => {
                          updateProject(project.id, {
                            risk_status: rk as RiskStatus,
                            is_at_risk: rk === 'At Risk' || rk === 'Critical',
                          });
                          setIsEditingRisk(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between text-slate-700"
                      >
                        <span>{rk}</span>
                        {project.risk_status === rk && <Check className="w-3.5 h-3.5 text-amber-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {client && (
                <span className="text-xs text-slate-500 font-semibold">
                  Client: <strong className="text-slate-900">{client.company_name}</strong>
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {project.project_name}
            </h1>

            <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-500">
              <span className="flex items-center space-x-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{project.site_address}</span>
              </span>
              <span className="text-slate-300">•</span>
              <span className="flex items-center space-x-1.5">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  PM: <strong className="text-slate-700">Marcus Lee</strong>
                </span>
              </span>
              <span className="text-slate-300">•</span>
              <span className="flex items-center space-x-1.5">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  Supervisor: <strong className="text-slate-700">Suresh Kumar</strong>
                </span>
              </span>
            </div>

            {project.risk_reason && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">Active Risk Notice:</strong> {project.risk_reason}
                </div>
              </div>
            )}
          </div>

          {/* Key Dates & Fast Actions */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-start lg:items-end gap-3 shrink-0">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left lg:text-right w-full sm:w-auto">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Target Handover Date
              </div>
              <div className="font-mono font-black text-base text-slate-900 flex items-center lg:justify-end space-x-1.5">
                <Calendar className="w-4 h-4 text-amber-600" />
                <span>{project.end_date}</span>
              </div>
              <div className="text-[11px] font-semibold mt-0.5">
                {isOverdue ? (
                  <span className="text-rose-600 font-bold">
                    ⚠️ {Math.abs(daysRemaining)} Days Overdue
                  </span>
                ) : (
                  <span className="text-emerald-700 font-bold">
                    ⏳ {daysRemaining} Calendar Days Remaining
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowNewItemModal(true)}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                <span>New Work Item</span>
              </button>
              <button
                onClick={() => {
                  setIssueTargetWorkItemId(undefined);
                  setEditingIssue(undefined);
                  setIssueModalOpen(true);
                }}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                <span>Report Issue</span>
              </button>
            </div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="space-y-1.5 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-600">Overall Project Execution Progress</span>
            <span className="font-mono text-slate-900 text-sm">{project.progress_percent}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
            <div
              className="bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${project.progress_percent}%` }}
            />
          </div>
        </div>
      </div>

      {isStaff && project && <ProjectServerOverview projectId={project.id} />}

      {/* 2. PROJECT HEALTH HEADER (6 Summary Cards) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Card 1: Progress */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Progress</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="font-mono font-black text-xl text-slate-900">
            {project.progress_percent}%
          </div>
          <div className="text-[11px] text-slate-500">
            {projWorkPackages.filter((w) => w.status === 'Completed').length} / {projWorkPackages.length} Pkgs Complete
          </div>
        </div>

        {/* Card 2: Schedule */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Schedule</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div
            className={`font-mono font-black text-xl ${
              isOverdue ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {isOverdue ? `+${Math.abs(daysRemaining)}d` : `${daysRemaining}d`}
          </div>
          <div className="text-[11px] text-slate-500">
            {isOverdue ? 'Behind target date' : 'Days until handover'}
          </div>
        </div>

        {/* Card 3: Production */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Production</span>
            <Factory className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="font-mono font-black text-xl text-slate-900">
            {productionPercent}%
          </div>
          <div className="text-[11px] text-slate-500">
            Factory Floor Queue
          </div>
        </div>

        {/* Card 4: Delivery */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Delivery</span>
            <Truck className="w-4 h-4 text-teal-600" />
          </div>
          <div className="font-mono font-black text-xl text-slate-900">
            {upcomingDeliveries.length}
          </div>
          <div className="text-[11px] text-slate-500">
            Scheduled Dispatches
          </div>
        </div>

        {/* Card 5: Issues */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Issues</span>
            <AlertTriangle
              className={`w-4 h-4 ${criticalIssues.length > 0 ? 'text-rose-600 animate-bounce' : 'text-amber-600'}`}
            />
          </div>
          <div
            className={`font-mono font-black text-xl ${
              criticalIssues.length > 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {openIssues.length}
            {criticalIssues.length > 0 && (
              <span className="text-xs font-normal text-rose-500 ml-1">
                ({criticalIssues.length} crit)
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500">
            Unresolved Site Items
          </div>
        </div>

        {/* Card 6: Financial (Permission Protected) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Financial</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          {canSeeFinancials ? (
            <>
              <div className="font-mono font-black text-lg text-slate-900 truncate">
                RM {(totalRevisedContract / 1000).toFixed(0)}k
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                +VO: RM {(approvedVariationsTotal / 1000).toFixed(0)}k
              </div>
            </>
          ) : (
            <>
              <div className="font-mono font-bold text-xs text-slate-400 flex items-center space-x-1 mt-1">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Restricted</span>
              </div>
              <div className="text-[10px] text-slate-400">
                Confidential B2B
              </div>
            </>
          )}
        </div>
      </div>

      {/* Navigation Quick Filter Tabs */}
      <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'ALL', label: 'All Command Modules' },
          { id: 'ACTIONS', label: `Today's Actions (${todayActions.length})` },
          { id: 'TIMELINE', label: 'Project Timeline' },
          { id: 'PACKAGES', label: `Work Packages (${projWorkPackages.length})` },
          { id: 'ITEMS', label: `Work Items (${projWorkItems.length})` },
          { id: 'PRODUCTION', label: 'Production Flow' },
          { id: 'ISSUES', label: `Issues (${projIssues.length})` },
          { id: 'DRAWINGS', label: `Drawing Alerts (${drawingAlerts.length})` },
          { id: 'FINANCE', label: 'Financials & Claims' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id as any)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeSection === tab.id
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 6. TODAY'S ACTIONS (Immediate Priority Execution Queue) */}
      {(activeSection === 'ALL' || activeSection === 'ACTIONS') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4" id="section-today">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
                  TODAY — Operational Action Queue
                </h2>
                <p className="text-xs text-slate-500">
                  Tasks requiring immediate resolution to prevent site stoppage or delays.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">
              {todayActions.length} Pending Actions
            </span>
          </div>

          {todayActions.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              <p className="font-bold text-slate-700">All actions for today are clear!</p>
              <p>No immediate bottlenecks or overdue QC inspections flagged for this project.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {todayActions.map((action) => (
                <div
                  key={action.id}
                  className={`p-4 rounded-2xl border transition-all shadow-2xs space-y-2.5 ${
                    action.priority === 'CRITICAL'
                      ? 'bg-rose-50/50 border-rose-300'
                      : action.priority === 'HIGH'
                      ? 'bg-amber-50/40 border-amber-200'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          action.priority === 'CRITICAL'
                            ? 'bg-rose-600 text-white'
                            : action.priority === 'HIGH'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {action.priority}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-slate-500">
                        {action.refCode}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">• {action.category}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {action.dueTime}
                    </span>
                  </div>

                  <h3 className="text-xs font-bold text-slate-900 leading-snug">
                    {action.title}
                  </h3>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100/80">
                    <span className="text-[11px] text-slate-500 flex items-center space-x-1">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>Assigned: <strong>{action.responsible}</strong></span>
                    </span>

                    {/* Dynamic Action Button based on type */}
                    {action.type === 'qc' && (
                      <button
                        onClick={() => setQcWorkItem(action.payload)}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                      >
                        {action.actionLabel}
                      </button>
                    )}
                    {action.type === 'delivery' && (
                      <button
                        onClick={() => {
                          setDeliveryModalItem(action.payload);
                          setDeliveryModalMode('receive');
                        }}
                        className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                      >
                        {action.actionLabel}
                      </button>
                    )}
                    {action.type === 'issue' && (
                      <button
                        onClick={() => {
                          setEditingIssue(action.payload);
                          setIssueTargetWorkItemId(action.payload.work_item_id);
                          setIssueModalOpen(true);
                        }}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                      >
                        {action.actionLabel}
                      </button>
                    )}
                    {action.type === 'drawing' && onNavigateToTab && (
                      <button
                        onClick={() => onNavigateToTab('drawings')}
                        className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                      >
                        {action.actionLabel}
                      </button>
                    )}
                    {action.type === 'variation' && onNavigateToTab && (
                      <button
                        onClick={() => onNavigateToTab('variations')}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                      >
                        {action.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. VISUAL PROJECT TIMELINE */}
      {(activeSection === 'ALL' || activeSection === 'TIMELINE') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>PROJECT LIFECYCLE TIMELINE</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({project.start_date} → {project.end_date})
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Baseline contractual sequence. Delays on trade packages are visually highlighted without altering contractual dates.
              </p>
            </div>
            <div className="flex items-center space-x-2 text-xs font-bold">
              <span className="flex items-center space-x-1 text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>On Track</span>
              </span>
              <span className="flex items-center space-x-1 text-amber-700 ml-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                <span>Attention</span>
              </span>
              <span className="flex items-center space-x-1 text-rose-700 ml-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                <span>Critical Delay</span>
              </span>
            </div>
          </div>

          {/* Stepper Flow */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 pt-2">
            {[
              {
                step: '1',
                title: 'Contract / LA',
                date: project.signed_date || '2026-06-25',
                status: 'Completed',
                detail: 'LA Signed & Deposit Cleared',
                progress: 100,
              },
              {
                step: '2',
                title: 'Pre-Start',
                date: project.start_date || '2026-07-01',
                status: 'Completed',
                detail: 'Site Measure & Mall Permit',
                progress: 100,
              },
              {
                step: '3',
                title: 'Production',
                date: '2026-07-15 to 2026-09-30',
                status: 'In Progress',
                detail: `${productionPercent}% Factory Build (CAR-003 scribing hold)`,
                progress: productionPercent,
                hasDelay: project.is_at_risk,
              },
              {
                step: '4',
                title: 'Delivery',
                date: '2026-09-27 to 2026-10-05',
                status: 'Scheduled',
                detail: `${upcomingDeliveries.length} Dispatches (Pavilion Bay 3)`,
                progress: 40,
              },
              {
                step: '5',
                title: 'Installation',
                date: '2026-10-01 to 2026-10-18',
                status: 'Pending',
                detail: 'Joinery Fix & On-site Join',
                progress: 15,
              },
              {
                step: '6',
                title: 'Completion',
                date: project.end_date || '2026-10-24',
                status: 'Target',
                detail: 'Handover & CPC Inspection',
                progress: 0,
              },
            ].map((stage, idx) => (
              <div
                key={stage.step}
                className={`p-3.5 rounded-2xl border transition-all ${
                  stage.status === 'Completed'
                    ? 'bg-slate-50 border-emerald-300'
                    : stage.status === 'In Progress'
                    ? stage.hasDelay
                      ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/20'
                      : 'bg-white border-amber-400'
                    : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">
                    {stage.step}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      stage.status === 'Completed'
                        ? 'text-emerald-700'
                        : stage.status === 'In Progress'
                        ? 'text-amber-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {stage.status}
                  </span>
                </div>
                <div className="font-bold text-xs text-slate-900">{stage.title}</div>
                <div className="font-mono text-[10px] text-slate-500 mt-0.5">{stage.date}</div>
                <p className="text-[11px] text-slate-600 mt-1 leading-tight line-clamp-2">
                  {stage.detail}
                </p>
                {stage.hasDelay && (
                  <div className="mt-2 text-[10px] font-bold text-amber-700 bg-amber-100/70 px-1.5 py-0.5 rounded border border-amber-300 flex items-center space-x-1">
                    <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                    <span>Delay Risk</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. WORK PACKAGE OVERVIEW */}
      {(activeSection === 'ALL' || activeSection === 'PACKAGES') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>WORK PACKAGES & TRADE PARTNERS</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({projWorkPackages.length} Packages)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Click any Work Package to inspect assigned items, specs, and schedule.
              </p>
            </div>
            <button
              onClick={() => setShowNewPackageModal(true)}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-2xs flex items-center space-x-1.5 transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5 text-slate-950" />
              <span>+ New Work Package</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projWorkPackages.map((wp) => {
              const contractor = contractors.find((c) => c.id === wp.contractor_id);
              const pkgItems = projWorkItems.filter((w) => w.work_package_id === wp.id);
              const pkgIssues = projIssues.filter(
                (i) =>
                  i.status !== 'Resolved' &&
                  pkgItems.some((item) => item.id === i.work_item_id)
              );
              const isDelayed =
                wp.status === 'Blocked' ||
                (wp.end_date && new Date(wp.end_date) < today && wp.progress_percent < 100);

              return (
                <div
                  key={wp.id}
                  onClick={() => setSelectedWorkPackageId(wp.id)}
                  className="bg-white border border-slate-200 hover:border-amber-400 rounded-2xl p-4.5 shadow-2xs hover:shadow-md transition-all cursor-pointer space-y-3 relative group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        {wp.category || wp.trade || 'General Trade'}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-1.5 group-hover:text-amber-800 transition-colors">
                        {wp.name}
                      </h3>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        wp.status === 'Completed'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : isDelayed
                          ? 'bg-rose-50 text-rose-800 border-rose-300'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {wp.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Contractor:</span>
                      <strong className="text-slate-800 truncate max-w-[170px]">
                        {contractor ? contractor.company_name.split('(')[0] : 'Unassigned'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Required Completion:</span>
                      <span className="font-mono text-slate-700 font-semibold">{wp.end_date}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Items / Issues:</span>
                      <span className="font-medium">
                        {pkgItems.length} items •{' '}
                        <strong className={pkgIssues.length > 0 ? 'text-rose-600' : 'text-slate-600'}>
                          {pkgIssues.length} open issues
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-slate-500">Progress</span>
                      <span className="font-mono text-slate-800">{wp.progress_percent}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isDelayed ? 'bg-rose-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${wp.progress_percent}%` }}
                      />
                    </div>
                  </div>

                  {isDelayed && (
                    <div className="text-[10px] text-rose-700 bg-rose-50 px-2 py-1 rounded border border-rose-200 font-bold flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                      <span>Behind Baseline Schedule</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. WORK ITEM STATUS (Interactive Filter Counts & Drill-Down) */}
      {(activeSection === 'ALL' || activeSection === 'ITEMS') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5" id="section-work-items">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>WORK ITEM STATUS MATRIX</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  (Click any status to filter)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                15 distinct lifecycle states across bespoke production, QC checks, and site installation.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                All ({projWorkItems.length})
              </button>
              <button
                onClick={() => setShowNewItemModal(true)}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-2xs flex items-center space-x-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-slate-950" />
                <span>+ Work Item</span>
              </button>
            </div>
          </div>

          {/* 15 Status Count Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2">
            {STATUS_LIST.map((st) => {
              const count = statusCounts[st] || 0;
              const isSelected = statusFilter === st;

              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(isSelected ? 'ALL' : st)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-600 ring-2 ring-amber-400/40 font-bold shadow-xs'
                      : count > 0
                      ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                      : 'bg-white border-slate-150 text-slate-400 opacity-60'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold truncate tracking-wider block">
                    {st}
                  </span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-mono text-base font-black">{count}</span>
                    {st === 'QC Failed' && count > 0 && (
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    )}
                    {st === 'Blocked' && count > 0 && (
                      <span className="w-2 h-2 rounded-full bg-red-600" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Search & Trade Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search item code, description, or room..."
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400 font-bold">Trade:</span>
              <select
                value={tradeFilter}
                onChange={(e) => setTradeFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All Trades</option>
                <option value="Carpentry">Carpentry</option>
                <option value="Electrical">Electrical</option>
                <option value="Glass">Glass</option>
                <option value="Metal">Metal</option>
                <option value="Painting">Painting</option>
                <option value="Ceiling">Ceiling</option>
              </select>
            </div>
          </div>

          {/* Filtered Work Items Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Item Code</th>
                    <th className="px-4 py-3">Description & Scope</th>
                    <th className="px-4 py-3">Location / Specs</th>
                    <th className="px-4 py-3">Trade / Contractor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Production</th>
                    <th className="px-4 py-3">Delivery</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-medium">
                  {filteredWorkItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400 text-xs">
                        No work items match the selected filter ({statusFilter}).
                      </td>
                    </tr>
                  ) : (
                    filteredWorkItems.map((item) => {
                      const contractor = contractors.find((c) => c.id === item.contractor_id);
                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50/70 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                            <button
                              onClick={() => setSelectedWorkItemId(item.id)}
                              className="text-amber-800 hover:text-amber-900 hover:underline flex items-center space-x-1"
                            >
                              <span>{item.item_code}</span>
                              <ChevronRight className="w-3 h-3 text-slate-400" />
                            </button>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <div className="font-bold text-slate-900 truncate">
                              {item.description}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {item.dimensions} • {item.material}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 whitespace-nowrap">
                            {item.location}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-700 whitespace-nowrap">
                            {contractor ? contractor.company_name.split('(')[0] : 'Unassigned'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                item.status === 'Completed'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : item.status === 'QC Failed'
                                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                                  : item.status === 'Ready for QC'
                                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[11px] font-medium text-slate-600 whitespace-nowrap">
                            {item.production_status}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 whitespace-nowrap">
                            {item.delivery_status}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                            <button
                              onClick={() => setSelectedWorkItemId(item.id)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
                            >
                              Details
                            </button>
                            {item.status === 'Ready for QC' && (
                              <button
                                onClick={() => setQcWorkItem(item)}
                                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold transition-colors cursor-pointer"
                              >
                                QC
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 9. PRODUCTION STATUS FLOW */}
      {(activeSection === 'ALL' || activeSection === 'PRODUCTION') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>PRODUCTION PIPELINE & WORKSHOP QUEUE</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  (10 Industrial Stages)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Live shop-floor tracker across cutting, CNC, edge-banding, assembly, and factory QC gates.
              </p>
            </div>
            <div className="font-mono text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-lg border border-amber-200">
              Factory Throughput: {productionPercent}%
            </div>
          </div>

          {/* 10 Production Stages Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 pt-1">
            {PROD_STAGES.map((st, index) => {
              const count = prodStageCounts[st.key] || 0;
              const hasItems = count > 0;
              const isBottleneck = st.key === 'Assembly' && count > 0;

              return (
                <div
                  key={st.key}
                  className={`p-3 rounded-2xl border text-center transition-all ${
                    isBottleneck
                      ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-400/20'
                      : hasItems
                      ? 'bg-slate-50 border-slate-300 shadow-2xs'
                      : 'bg-white border-slate-150 opacity-60'
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold mx-auto flex items-center justify-center mb-1">
                    {index + 1}
                  </div>
                  <div className="text-[10px] font-bold text-slate-700 leading-tight h-6 flex items-center justify-center">
                    {st.label}
                  </div>
                  <div className="mt-2 font-mono font-black text-sm text-slate-900">
                    {count} <span className="text-[10px] font-normal text-slate-400">items</span>
                  </div>
                  {isBottleneck && (
                    <div className="mt-1 text-[9px] font-bold text-amber-700 bg-amber-100 rounded py-0.5 px-1">
                      ⚠️ Queue Active
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. ISSUES PANEL & ESCALATION RADAR */}
      {(activeSection === 'ALL' || activeSection === 'ISSUES') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4" id="section-issues">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>PROJECT ISSUES & EXCEPTIONS</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({projIssues.length} Reported)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Hierarchical resolution: Site Supervisor → PM → Owner. AI routes issues but never takes restricted decisions.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                {(['ALL', 'Critical', 'High', 'Medium', 'Low'] as const).map((pr) => (
                  <button
                    key={pr}
                    onClick={() => setIssuePriorityFilter(pr)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      issuePriorityFilter === pr
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    {pr}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setEditingIssue(undefined);
                  setIssueTargetWorkItemId(undefined);
                  setIssueModalOpen(true);
                }}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-2xs flex items-center space-x-1.5 cursor-pointer ml-2"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Report Issue</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {projIssues
              .filter((i) => issuePriorityFilter === 'ALL' || i.priority === issuePriorityFilter)
              .map((issue) => {
                const workItem = projWorkItems.find((w) => w.id === issue.work_item_id);
                return (
                  <div
                    key={issue.id}
                    className={`p-4 rounded-2xl border transition-all shadow-2xs space-y-3 ${
                      issue.priority === 'Critical'
                        ? 'bg-rose-50/60 border-rose-300'
                        : issue.priority === 'High'
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            issue.priority === 'Critical'
                              ? 'bg-rose-600 text-white animate-pulse'
                              : issue.priority === 'High'
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {issue.priority}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-500">{issue.id}</span>
                        <span className="text-xs text-slate-400 font-semibold">• {issue.category}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-slate-400">Status:</span>
                        <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {issue.status}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{issue.title}</h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {issue.description}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                      <div className="flex items-center space-x-3">
                        <span>
                          Reported by: <strong>{issue.reported_by}</strong> ({issue.reported_by_role})
                        </span>
                        <span>•</span>
                        <span>
                          Assigned to: <strong className="text-slate-800">{issue.assigned_to}</strong>
                        </span>
                        {workItem && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-amber-800 font-bold">
                              Item: {workItem.item_code}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        {issue.status !== 'Resolved' && (
                          <>
                            {currentUser.role === 'Project Manager' && (
                              <button
                                onClick={() =>
                                  escalateIssue(
                                    issue.id,
                                    'Owner',
                                    'Escalated by PM Marcus Lee: Requires commercial variation authorization or drawing override from Dato Nicholas.'
                                  )
                                }
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                              >
                                Escalate to Owner
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setEditingIssue(issue);
                                setIssueModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                            >
                              Update / Resolve
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 8. DRAWING / REVISION ALERTS */}
      {(activeSection === 'ALL' || activeSection === 'DRAWINGS') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4" id="section-drawings">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>DRAWING REVISION & PRODUCTION IMPACT ALERTS</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({drawingAlerts.length} Active Alerts)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Automated impact checks comparing designer updates against workshop cutting and assembly status.
              </p>
            </div>
            {onNavigateToTab && (
              <button
                onClick={() => onNavigateToTab('drawings')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <span>Full Drawing Hub →</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {drawingAlerts.map((alert) => (
              <div
                key={alert.id}
                className="p-5 rounded-2xl bg-amber-50/50 border border-amber-300 shadow-2xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">⚠️</span>
                    <span className="font-mono font-black text-sm text-slate-900">
                      {alert.drawingNumber} {alert.revision}
                    </span>
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white animate-pulse">
                      {alert.statusText}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 font-semibold">
                    Production Stage:{' '}
                    <strong className="text-amber-800">{alert.productionStage}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="bg-white/80 p-3 rounded-xl border border-slate-200 space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">
                      Previous Specification (Rev 3)
                    </div>
                    <div className="font-medium text-slate-800">{alert.previousSpec}</div>
                  </div>
                  <div className="bg-white/80 p-3 rounded-xl border border-amber-300 space-y-1">
                    <div className="text-[10px] font-bold text-amber-700 uppercase">
                      New Specification ({alert.revision})
                    </div>
                    <div className="font-bold text-slate-900">{alert.newSpec}</div>
                  </div>
                </div>

                <div className="text-xs text-slate-700 bg-white/70 p-3 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-900">
                    Affected Item: {alert.affectedItemCode} — {alert.affectedItemDescription}
                  </div>
                  <p className="mt-1 text-slate-600">
                    <strong>Action Suggested:</strong> {alert.suggestedAction}
                  </p>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    onClick={() => {
                      if (onNavigateToTab) onNavigateToTab('drawings');
                    }}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Review Revision
                  </button>
                  <button
                    onClick={() => {
                      setIssueTargetWorkItemId('item-1');
                      setIssueModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    Create Issue
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 11. FINANCIAL & VARIATIONS OVERVIEW */}
      {(activeSection === 'ALL' || activeSection === 'FINANCE') && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4" id="section-finance">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>COMMERCIAL & VARIATION HEALTH</span>
                {!canSeeFinancials && (
                  <span className="text-xs font-mono font-bold text-slate-400 flex items-center space-x-1">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>RESTRICTED</span>
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500">
                Summary of base contract value, variation orders (VOs), certified progress claims, and forecast margin.
              </p>
            </div>
            {canSeeFinancials && onNavigateToTab && (
              <button
                onClick={() => onNavigateToTab('finance')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <span>Full Financial Claims Ledger →</span>
              </button>
            )}
          </div>

          {canSeeFinancials ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                  <div className="text-[10px] uppercase font-bold text-slate-400">
                    Base Contract Value
                  </div>
                  <div className="font-mono font-black text-xl text-slate-900 mt-1">
                    RM {baseContractValue.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Awarded scope sum</div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                  <div className="text-[10px] uppercase font-bold text-emerald-600">
                    Approved Variations
                  </div>
                  <div className="font-mono font-black text-xl text-emerald-700 mt-1">
                    +RM {approvedVariationsTotal.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {approvedVariationsCount} VOs Approved
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                  <div className="text-[10px] uppercase font-bold text-purple-600">
                    Pending Variations
                  </div>
                  <div className="font-mono font-black text-xl text-purple-700 mt-1">
                    RM {pendingVariationsTotal.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Awaiting Client / Owner
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                  <div className="text-[10px] uppercase font-bold text-slate-400">
                    Revised Contract Forecast
                  </div>
                  <div className="font-mono font-black text-xl text-slate-900 mt-1">
                    RM {totalRevisedContract.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Net client billing</div>
                </div>
              </div>

              {/* Variations list */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Variations Log ({projVariations.length})
                  </span>
                  {onNavigateToTab && (
                    <button
                      onClick={() => onNavigateToTab('variations')}
                      className="text-xs font-bold text-amber-700 hover:text-amber-800"
                    >
                      + New Variation Order
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-100 bg-white">
                  {projVariations.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No variations currently recorded for this project.
                    </div>
                  ) : (
                    projVariations.map((v) => (
                      <div
                        key={v.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 transition-colors"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-xs text-slate-900">
                              {v.variation_number}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                v.status === 'Approved'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : v.status === 'Internal Approval'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-purple-50 text-purple-800 border-purple-200'
                              }`}
                            >
                              {v.status}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-800">{v.title}</div>
                        </div>

                        <div className="flex items-center space-x-4">
                          <div className="text-right">
                            <div className="font-mono font-bold text-xs text-slate-900">
                              RM {(v.client_amount || 0).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Cost: RM {(v.estimated_cost || 0).toLocaleString()}
                            </div>
                          </div>

                          {currentUser.role === 'Owner / CEO' && v.status === 'Internal Approval' && (
                            <button
                              onClick={() => approveVariation(v.id, false)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
                            >
                              Owner Approve
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <Lock className="w-8 h-8 mx-auto text-slate-400" />
              <p className="font-bold text-slate-700 text-sm">Commercial Financials Restricted</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                In accordance with NW OS security policies, detailed contract values, trade pricing, and margin forecasts are restricted to Project Managers, Accountants, and Executive Leadership.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 12. AI PROJECT BRIEFING MODAL */}
      {showBriefingModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 text-slate-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-700">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    AI Project Briefing & Risk Radar
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {project.project_number} — Generated by NW OS Intelligence Engine
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBriefingModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isGeneratingBriefing ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-amber-600 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Synthesizing site telemetry, factory assembly status, and open issues...
                </p>
                <p className="text-[11px] text-slate-400">
                  Formulating PM action checklist to eliminate Owner dependency.
                </p>
              </div>
            ) : briefingData ? (
              <div className="space-y-4 text-xs">
                {/* Executive Summary */}
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-1">
                  <div className="font-bold text-amber-900 text-xs uppercase tracking-wider">
                    Executive Health Summary
                  </div>
                  <p className="text-slate-800 font-medium leading-relaxed">
                    {briefingData.executive_summary}
                  </p>
                  <div className="text-[11px] font-mono text-amber-800 font-bold mt-2">
                    Handover Projection: {briefingData.handover_projection}
                  </div>
                </div>

                {/* Critical Path Bottlenecks */}
                <div className="space-y-1.5">
                  <div className="font-black text-slate-900 uppercase tracking-wider text-[11px]">
                    Critical Path Bottlenecks
                  </div>
                  <div className="space-y-1">
                    {(briefingData.critical_path_bottlenecks || []).map((bot: string, i: number) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start space-x-2"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                        <span className="text-slate-700">{bot}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PM Immediate Action Checklist */}
                <div className="space-y-1.5">
                  <div className="font-black text-slate-900 uppercase tracking-wider text-[11px]">
                    PM Autonomous Action Checklist (No Owner Intervention Needed)
                  </div>
                  <div className="space-y-1.5">
                    {(briefingData.pm_action_checklist || []).map((item: any, i: number) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{item.task}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                              item.priority === 'CRITICAL'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {item.priority}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          <strong>Reason:</strong> {item.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Owner Escalations Needed */}
                {(briefingData.owner_escalations_needed || []).length > 0 && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 space-y-1">
                    <div className="font-bold text-rose-900 text-xs uppercase tracking-wider">
                      Genuine Owner Escalation Required
                    </div>
                    <ul className="list-disc list-inside text-rose-800 space-y-0.5 text-[11px]">
                      {briefingData.owner_escalations_needed.map((esc: string, i: number) => (
                        <li key={i}>{esc}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowBriefingModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Close Briefing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALS INTEGRATION */}
      {/* 1. Work Package Detail Modal */}
      <WorkPackageDetailModal
        isOpen={!!selectedWorkPackageId}
        onClose={() => setSelectedWorkPackageId(null)}
        workPackageId={selectedWorkPackageId}
        onSelectWorkItem={(item) => setSelectedWorkItemId(item.id)}
      />

      {/* 2. Work Item Detail Modal */}
      <WorkItemDetailModal
        isOpen={!!selectedWorkItemId}
        onClose={() => setSelectedWorkItemId(null)}
        workItemId={selectedWorkItemId}
        onOpenQCModal={(item) => setQcWorkItem(item)}
        onOpenDeliveryModal={(item) => {
          setDeliveryModalItem(item);
          setDeliveryModalMode('schedule');
        }}
        onOpenIssueModal={(itemId) => {
          setIssueTargetWorkItemId(itemId);
          setEditingIssue(undefined);
          setIssueModalOpen(true);
        }}
      />

      {/* 3. QC Modal */}
      {qcWorkItem && (
        <QCModal
          isOpen={true}
          onClose={() => setQcWorkItem(null)}
          workItem={qcWorkItem}
        />
      )}

      {/* 4. Delivery Modal */}
      {deliveryModalItem && (
        <DeliveryModal
          isOpen={true}
          onClose={() => setDeliveryModalItem(null)}
          workItem={deliveryModalItem}
          mode={deliveryModalMode}
        />
      )}

      {/* 5. Issue Creation & Resolution Modal */}
      <IssueModal
        isOpen={issueModalOpen}
        onClose={() => {
          setIssueModalOpen(false);
          setEditingIssue(undefined);
          setIssueTargetWorkItemId(undefined);
        }}
        defaultWorkItemId={issueTargetWorkItemId}
        existingIssue={editingIssue}
      />

      {/* 6. New Work Package Modal */}
      <NewWorkPackageModal
        isOpen={showNewPackageModal}
        onClose={() => setShowNewPackageModal(false)}
        onSuccess={() => {}}
        defaultProjectId={project.id}
      />

      {/* 7. New Work Item Modal (needs a work package; uses the project's first one) */}
      {projWorkPackages.length > 0 && (
        <NewWorkItemModal
          isOpen={showNewItemModal}
          onClose={() => setShowNewItemModal(false)}
          workPackage={projWorkPackages[0]}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
};
