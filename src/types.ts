/**
 * NW OS — Company Operating System
 * Core Architecture & Database Entity Types
 */

export type UserRole =
  | 'Owner / CEO'
  | 'Admin'
  | 'Project Manager'
  | 'Site Supervisor'
  | 'Purchasing'
  | 'Accountant'
  | 'Production Manager'
  | 'Production Staff'
  | 'Contractor'
  | 'Client';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  phone?: string;
  department?: string;
  title?: string;
  status?: 'active' | 'inactive';
  assigned_project_ids?: string[]; // Project-level access assignment
  contractor_id?: string;          // If Contractor role
  client_id?: string;              // If Client role
  avatar?: string;
  custom_permissions?: string[];   // Optional supplementary permissions
  created_at?: string;
}

export type ClientType =
  | 'Company'
  | 'Individual / Homeowner'
  | 'Corporate'
  | 'Retail'
  | 'Commercial'
  | 'F&B'
  | 'Luxury Residential';

export interface Client {
  id: string;
  client_type: ClientType;
  company_name: string;
  registration_number: string; // Malaysian SSM No.
  contact_person: string;
  email: string;
  phone: string;
  billing_address: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus =
  | 'Awarded'
  | 'Pre-Start'
  | 'Active'
  | 'Practical Completion'
  | 'Completed'
  | 'Closed'
  | 'On Hold';

export type RiskStatus =
  | 'On Track'
  | 'Attention'
  | 'At Risk'
  | 'Critical';

export interface Project {
  id: string;
  project_number: string; // e.g. "NW-2026-088"
  project_name: string;
  client_id: string;
  site_address: string;
  contract_value: number; // in Malaysian Ringgit (MYR / RM)
  project_status: ProjectStatus;
  risk_status?: RiskStatus;
  start_date: string;
  end_date: string;
  signed_date: string;
  project_manager_id: string;
  site_supervisor_id: string;
  progress_percent: number;
  description: string;
  is_at_risk?: boolean;
  risk_reason?: string;
  created_at: string;
  updated_at: string;
}

export type ContractorType = 'Company' | 'Individual';

export type ContractorTrade =
  | 'Carpentry'
  | 'Electrical'
  | 'Glass'
  | 'Metal'
  | 'Painting'
  | 'Ceiling'
  | 'Flooring'
  | 'Plumbing'
  | 'Other';

export interface Contractor {
  id: string;
  contractor_type?: ContractorType;
  company_name: string;
  registration_number?: string;
  contact_person: string;
  phone: string;
  email?: string;
  trade: ContractorTrade | string;
  address?: string;
  notes?: string;
  is_active?: boolean;
  preferred_languages?: ('English' | 'Bahasa Malaysia' | 'Chinese')[];
  rating?: number;
  created_at?: string;
  updated_at?: string;
}

export type DocumentType =
  | 'Letter of Award'
  | 'Contract'
  | 'Insurance'
  | 'BQ'
  | 'Tender documents'
  | 'Specifications'
  | 'Drawings'
  | 'Site measurements'
  | 'Meeting minutes'
  | 'Photos'
  | 'Other';

export interface ProjectDocument {
  id: string;
  project_id: string;
  document_type: DocumentType;
  title: string;
  file_url: string;
  file_size?: string;
  revision?: string;
  uploaded_by: string;
  uploaded_at: string;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Superseded';
}

export type DrawingType =
  | 'Client / Designer Drawing'
  | 'Site Measurement'
  | 'NW Production Drawing'
  | 'NW Installation Drawing'
  | 'Other';

export type DrawingStatus =
  | 'Draft'
  | 'Submitted'
  | 'Pending Review'
  | 'Review'
  | 'Approved'
  | 'Superseded'
  | 'Rejected';

export type DrawingMarkupType =
  | 'dimension'
  | 'text'
  | 'arrow'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'shape'
  | 'highlight'
  | 'production_note'
  | 'installation_note'
  | 'material_note'
  | 'hardware_note';

export interface DrawingMarkup {
  id: string;
  drawing_revision_id: string;
  user_name: string;
  user_role: string;
  date_time: string;
  markup_type: DrawingMarkupType;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width?: number; // percentage width for shapes/rectangles
  height?: number; // percentage height for shapes/rectangles
  content: string;
  color?: string;
}

export interface AISuggestedWorkItem {
  id?: string;
  item_code: string;
  item_code_suggestion?: string;
  description: string;
  suggested_work_package?: string;
  dimensions: string;
  material: string;
  finish: string;
  location: string;
  quantity: number;
  unit?: string;
  trade?: string;
  status: 'suggested' | 'approved' | 'rejected';
  confidence_percent?: number;
  reasoning?: string;
}

export interface MatchedKnowledgeStandard {
  id: string;
  title: string;
  category: string;
  recommendation: string;
  source: string;
}

export interface AIDrawingAnalysis {
  label: 'AI DRAFT' | 'AI DRAFT — NOT APPROVED';
  drawing_number: string;
  revision: string;
  dimensions: string[];
  quantities: string[];
  materials: string[];
  finishes: string[];
  locations?: string[];
  detail_references?: string[];
  work_items: string[];
  potential_work_items?: AISuggestedWorkItem[];
  production_concerns: string[];
  missing_info: string[];
  conflicting_info?: string[];
  nw_recommendations: string[];
  matched_knowledge?: MatchedKnowledgeStandard[];
  analyzed_at?: string;
}

export interface AffectedWorkItemCheck {
  work_item_id: string;
  item_code: string;
  description: string;
  current_status?: string;
  current_stage?: string;
  production_status: ProductionStatus | string;
  impact_level: 'PRODUCTION IMPACT POSSIBLE' | 'HIGH PRIORITY — REVISION AFTER COMPLETION' | 'LOW IMPACT';
  warning_message?: string;
  action_suggested?: string;
  action_needed?: string;
  suggested_action?: string;
}

export interface RevisionComparison {
  id?: string;
  drawing_id: string;
  from_revision: string;
  to_revision: string;
  old_revision?: string;
  new_revision?: string;
  dimension_changes: string[];
  material_changes: string[];
  finish_changes: string[];
  quantity_changes: string[];
  location_changes: string[];
  detail_changes: string[];
  added_items: string[];
  removed_items: string[];
  affected_work_items: AffectedWorkItemCheck[];
  compared_at: string;
  warning_level?: 'normal' | 'warning' | 'critical';
  summary?: string;
  impact_check?: {
    has_production_impact: boolean;
    requires_site_action: boolean;
    severity_level: 'NORMAL' | 'WARNING' | 'CRITICAL';
    headline: string;
    detail: string;
  };
  changes?: Array<{
    category: string;
    type: string;
    description: string;
    severity: 'normal' | 'warning' | 'critical';
    old_value?: string;
    new_value?: string;
  }>;
}

export interface NWProductionReview {
  id: string;
  drawing_id: string;
  client_drawing_revision: string;
  status: 'Draft' | 'Review' | 'Approved' | 'Rejected';
  reviewed_by: string;
  reviewer_role: string;
  review_date: string;
  review_category?: KnowledgeCategory;
  production_recommendation: string;
  reason: string;
  material_recommendation?: string;
  construction_method?: string;
  joining_method?: string;
  hardware?: string;
  transport_consideration?: string;
  installation_method?: string;
  production_risk?: string;
  notes?: string;
  photos?: string[];
  linked_nw_production_drawing_id?: string;
  is_company_standard?: boolean;
}

export interface NWProductionDrawing {
  id: string;
  drawing_number: string; // e.g. "A-103-NW"
  revision: string; // e.g. "Rev 1"
  title: string;
  linked_client_drawing_id: string;
  linked_client_revision: string;
  status: 'Draft' | 'Internal Review' | 'Pending Approval' | 'Approved' | 'Superseded';
  approved_for_production: boolean;
  approved_by?: string;
  approved_date?: string;
  revised_dimensions: string;
  construction_details: string;
  material_details: string;
  hardware_details: string;
  joining_method: string;
  assembly_instructions: string;
  installation_instructions: string;
  production_notes: string;
  file_url: string;
  uploaded_by: string;
  uploaded_date: string;
}

export interface ProductionInstruction {
  id: string;
  work_item_id: string;
  item_code: string;
  description: string;
  approved_drawing_number: string;
  approved_drawing_revision: string;
  approved_nw_drawing_number?: string;
  approved_nw_drawing_revision?: string;
  dimensions: string;
  construction: string;
  material: string;
  finish: string;
  production_notes: string;
  installation_notes: string;
  approved_by: string;
  approved_at: string;
  status: 'Approved for Production';
}

export interface DrawingRevision {
  id: string;
  drawing_id: string;
  revision: string; // e.g. "Rev 1", "Rev 2", "Rev 3", "Rev 4"
  title: string;
  file_url: string;
  uploaded_date: string;
  uploaded_by: string;
  approved_status: 'Pending Review' | 'Approved' | 'Superseded' | 'Rejected' | 'Draft' | 'Review';
  supersedes_revision?: string;
  notes: string;
  is_current: boolean;
  drawing_type: DrawingType;
  ai_analysis?: AIDrawingAnalysis;
  markups: DrawingMarkup[];
  comparison_with_previous?: RevisionComparison;
  suggested_work_items?: AISuggestedWorkItem[];
}

export interface Drawing {
  id: string;
  project_id: string;
  drawing_number: string; // e.g. "A-103"
  title: string;
  category: string; // e.g. "Carpentry / Joinery"
  drawing_type?: DrawingType;
  status?: DrawingStatus;
  current_revision_id: string;
  revisions: DrawingRevision[];
  production_reviews?: NWProductionReview[];
  nw_production_drawings?: NWProductionDrawing[];
  file_url?: string;
  uploaded_by?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export type KnowledgeCategory =
  | 'Carpentry'
  | 'Joinery'
  | 'Materials'
  | 'Joining Methods'
  | 'Transport'
  | 'Installation'
  | 'Common Mistakes'
  | 'Hardware Preferences'
  | 'Production Limitations'
  | 'Standard Dimensions'
  | 'Practical Solutions';

export type KnowledgeStatus = 'Draft' | 'Review' | 'Approved' | 'Archived';

export interface NWProductionKnowledge {
  id: string;
  title: string;
  category: KnowledgeCategory;
  description: string;
  reason: string;
  example: string;
  photos?: string[];
  created_by: string;
  approved_by?: string;
  status: KnowledgeStatus;
  source_project_id?: string;
  created_at: string;
}

export type WorkPackageTrade =
  | 'Carpentry'
  | 'Electrical'
  | 'Glass'
  | 'Metal'
  | 'Painting'
  | 'Ceiling'
  | 'Flooring'
  | 'Plumbing'
  | 'Other';

export type WorkPackageStatus =
  | 'Draft'
  | 'Assigned'
  | 'Contractor Confirmed'
  | 'In Progress'
  | 'Ready for QC'
  | 'QC Failed'
  | 'QC Passed'
  | 'Ready for Delivery'
  | 'Completed'
  | 'On Hold'
  | 'Blocked'
  | 'Cancelled';

export interface WorkPackage {
  id: string;
  project_id: string;
  name: string; // e.g. CARPENTRY & ARCHITECTURAL JOINERY
  category: WorkPackageTrade | string;
  trade?: WorkPackageTrade | string;
  contractor_id: string;
  project_manager_id: string;
  start_date: string;
  end_date: string;
  status: WorkPackageStatus | string;
  progress_percent: number;
  notes?: string;
  scope?: string;
  created_at?: string;
  updated_at?: string;
}

export type WorkItemStatus =
  | 'Draft'
  | 'Assigned'
  | 'Contractor Confirmed'
  | 'In Progress'
  | 'Ready for QC'
  | 'QC Failed'
  | 'QC Passed'
  | 'Ready for Delivery'
  | 'Delivered'
  | 'Installation In Progress'
  | 'Installation QC'
  | 'Completed'
  | 'On Hold'
  | 'Blocked'
  | 'Cancelled';

export type ProductionStatus =
  | 'Not Started'
  | 'Material Required'
  | 'Material Ready'
  | 'Cutting'
  | 'CNC'
  | 'Edge Banding'
  | 'Assembly'
  | 'Finishing'
  | 'QC'
  | 'Packing'
  | 'Ready for Delivery'
  | 'Completed'
  | 'Blocked'
  | 'Cancelled';

export type ProductionOrderStatus = ProductionStatus;

export type DeliveryStatus =
  | 'Not Scheduled'
  | 'Scheduled'
  | 'Loading'
  | 'In Transit'
  | 'Arrived at Site'
  | 'Delivered'
  | 'Received / Confirmed'
  | 'Delivery Issue'
  | 'Cancelled'
  | 'Rescheduled';

export type InstallationStatus =
  | 'Not Started'
  | 'Scheduled'
  | 'In Progress'
  | 'Pending / Blocked'
  | 'Awaiting Inspection'
  | 'QC'
  | 'Rectification'
  | 'Completed'
  | 'Delayed';

export interface WorkItemPhotoRecord {
  id: string;
  url: string;
  uploaded_by: string;
  date_time: string;
  description?: string;
}

export interface WorkItem {
  id: string;
  work_package_id: string;
  project_id: string;
  item_code: string; // e.g. "CAR-003"
  description: string;
  location: string;
  quantity: number;
  unit: string;
  drawing_id: string;
  drawing_revision: string;
  client_drawing_id?: string;
  client_drawing_revision?: string;
  nw_production_drawing_id?: string;
  nw_production_drawing_revision?: string;
  production_instruction?: ProductionInstruction;
  revision_impact_alert?: {
    level?: 'PRODUCTION IMPACT POSSIBLE' | 'HIGH PRIORITY — REVISION AFTER COMPLETION';
    severity?: 'normal' | 'warning' | 'critical';
    message: string;
    from_revision?: string;
    to_revision?: string;
    new_revision?: string;
    detected_at: string;
    suggested_action?: string;
  };
  material: string;
  finish: string;
  dimensions: string; // e.g. "2400 × 900 × 1050mm"
  required_date: string;
  contractor_id: string;
  status: WorkItemStatus;
  progress_percent: number;
  notes?: string;
  photos: string[];
  item_photos?: WorkItemPhotoRecord[];
  production_order_id?: string;
  production_status: ProductionStatus;
  delivery_status: DeliveryStatus;
  installation_status: InstallationStatus;
  scheduled_delivery_date?: string;
  scheduled_delivery_time?: string;
  received_delivery_date?: string;
  created_at: string;
  updated_at: string;
}

export interface QCRecord {
  id: string;
  work_item_id: string;
  project_id: string;
  inspector_name: string;
  inspector_role: string;
  inspection_date: string;
  result: 'Passed' | 'Failed' | 'Correction Required';
  comments: string;
  photos: string[];
  correction_requested?: string;
  re_inspected_at?: string;
}

export type IssueCategory =
  | 'Drawing'
  | 'Drawing / Design'
  | 'Site condition'
  | 'Material'
  | 'Production'
  | 'Delivery'
  | 'Installation'
  | 'Contractor'
  | 'Client'
  | 'Cost'
  | 'Variation'
  | 'Safety'
  | 'Schedule'
  | 'Other';

export type IssueStatus =
  | 'Reported'
  | 'Assigned'
  | 'Investigating'
  | 'Waiting for Info'
  | 'Decision Required'
  | 'Action in Progress'
  | 'Resolved'
  | 'Closed';

export type EscalationLevel = 'Contractor' | 'Site Supervisor' | 'PM' | 'Owner';

export interface Issue {
  id: string;
  project_id: string;
  work_item_id?: string;
  title: string;
  category: IssueCategory;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  status: IssueStatus;
  reported_by: string;
  reported_by_role: string;
  assigned_to: string;
  escalation_level: EscalationLevel;
  action_required: string;
  description: string;
  resolution_notes?: string;
  location?: string;
  assigned_to_id?: string;
  assigned_to_name?: string;
  due_date?: string;
  photos?: string[];
  created_at: string;
  updated_at: string;
}

export type VariationStatus =
  | 'Identified'
  | 'Costing'
  | 'Internal Approval'
  | 'Client Approval'
  | 'Approved'
  | 'Rejected'
  | 'Implemented'
  | 'Closed';

export interface Variation {
  id: string;
  project_id: string;
  variation_number: string; // e.g. "VO-001"
  title: string;
  description: string;
  estimated_cost: number;
  client_amount: number;
  status: VariationStatus;
  requested_by: string;
  approved_by_owner?: string;
  approved_by_client?: string;
  drawings_affected?: string[];
  schedule_impact_days: number;
  created_at: string;
  updated_at?: string;
}

export interface NotificationItem {
  id: string;
  target_role: UserRole | 'ALL';
  target_user_id?: string;
  title: string;
  message: string;
  type: 'issue' | 'escalation' | 'qc' | 'delivery' | 'drawing' | 'variation' | 'overdue';
  priority: 'normal' | 'urgent';
  is_read: boolean;
  project_id?: string;
  link_type?: 'issue' | 'work_item' | 'drawing' | 'variation';
  link_id?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  role?: string;
  action: string;
  object_type: string;
  object_id: string;
  entity_id?: string;
  old_value?: string;
  new_value?: string;
  details?: string;
  timestamp: string;
}

// ----------------------------------------------------
// NW OS MODULE 13: PRODUCTION, CNC & QR/BARCODE FACTORY ENGINE
// ----------------------------------------------------

export type PartStatus =
  | 'Created'
  | 'Material Required'
  | 'Material Ready'
  | 'Cutting'
  | 'CNC'
  | 'Edge Banding'
  | 'Assembly'
  | 'Finishing'
  | 'QC'
  | 'Packed'
  | 'Completed'
  | 'Rejected'
  | 'Rework'
  | 'Blocked';

export type CNCJobStatus =
  | 'Queued'
  | 'Ready'
  | 'Running'
  | 'Completed'
  | 'Error'
  | 'Rejected'
  | 'Rework';

export interface ProductionOrderStageTransition {
  stage: ProductionOrderStatus;
  timestamp: string;
  updated_by: string;
  role: string;
  notes?: string;
}

export interface ProductionOrder {
  id: string;
  order_number: string; // e.g. "PO-2026-003"
  project_id: string;
  project_number: string;
  project_name: string;
  work_package_id: string;
  work_package_name: string;
  work_item_id: string;
  work_item_code: string; // e.g. "CAR-003"
  client_id: string;
  client_name: string;
  location: string;
  contractor_id: string;
  contractor_name: string;
  production_manager_id: string;
  production_manager_name: string;
  required_date: string;
  current_stage: ProductionOrderStatus;
  priority: 'Normal' | 'High' | 'Urgent';
  status: ProductionOrderStatus;
  approved_client_drawing_id: string;
  approved_client_drawing_revision: string; // e.g. "A-103 Rev 4"
  approved_nw_production_drawing_id: string;
  approved_nw_production_drawing_revision: string; // e.g. "A-103-NW Rev 1"
  production_method: string; // e.g. "NW-PM-Counter-001 Rev 2"
  material: string;
  finish: string;
  dimensions: string; // e.g. "2400 × 900 × 1050mm"
  quantity: number;
  notes: string;
  photos: string[];
  barcode: string;
  qr_code: string;
  revision_alert?: {
    level: 'REVISION REVIEW REQUIRED' | 'PRODUCTION IMPACT POSSIBLE' | 'REVISION AFTER PRODUCTION';
    detected_revision: string;
    message: string;
    flagged_date: string;
    resolved: boolean;
  };
  stage_history: ProductionOrderStageTransition[];
  parts_count?: number;
  cnc_files?: string[];
  stage?: ProductionStatus;
  factory_target_date?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductionPart {
  id: string;
  production_order_id: string;
  production_order_number: string;
  work_item_id: string;
  work_item_code: string;
  part_code: string; // e.g. "CAR-003-P01"
  part_name: string; // e.g. "Top Panel Substrate"
  description: string;
  material_code: string;
  material: string;
  supplier_name: string;
  thickness_mm: number;
  length_mm: number;
  width_mm: number;
  quantity: number;
  edge_banding: string; // e.g. "1mm Natural Oak PVC - 4 Edges"
  finish: string;
  grain_direction: 'Length' | 'Width' | 'None';
  drawing_reference: string;
  cnc_file_id?: string;
  cnc_file_name?: string;
  cnc_file_revision?: string;
  cnc_program?: string;
  barcode: string;
  qr_code: string;
  current_stage: PartStatus;
  status: PartStatus;
  dimensions?: string;
  rework_notes?: string;
  notes?: string;
  history?: {
    stage: PartStatus;
    timestamp: string;
    operator: string;
    notes?: string;
  }[];
  created_at: string;
  updated_at: string;
}

export interface ProductionMaterialLink {
  id: string;
  material_code: string;
  material_name: string;
  supplier_name: string;
  thickness_mm: number;
  sheet_size: string; // e.g. "1220 × 2440mm (4 × 8 ft)"
  colour_finish: string;
  unit_cost: number;
  current_stock_sheets: number;
  approved_project_use: string[];
  substitution_rule: 'Requires PM & Owner Approval' | 'Standard Alternative Allowed';
}

export interface CNCJob {
  id: string;
  job_id_code: string; // e.g. "CNC-2026-042"
  production_order_id: string;
  production_order_number: string;
  part_id: string;
  part_code: string;
  part_name: string;
  material: string;
  thickness_mm: number;
  dimensions: string;
  cnc_file_name: string;
  cnc_file_revision: string;
  is_outdated: boolean;
  machine: string; // e.g. "Biesse Rover B FT 2231"
  operator: string;
  status: CNCJobStatus;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  quantity: number;
  rejected_quantity: number;
  tooling_notes: string;
  gcode_snippet: string;
  notes?: string;
}

export interface CNCFileVersion {
  id: string;
  file_name: string;
  revision: string;
  part_code: string;
  machine_compatibility: string;
  gcode_summary: string;
  toolpath_count: number;
  estimated_run_time_min: number;
  uploaded_at: string;
  approved_by: string;
  status: 'Approved' | 'OUTDATED / REQUIRES RE-GENERATION' | 'Superseded';
  associated_drawing_revision: string;
}

export interface AssemblyJob {
  id: string;
  production_order_id: string;
  production_order_number: string;
  work_item_code: string;
  description: string;
  status: 'Waiting for Parts' | 'Ready for Assembly' | 'In Assembly' | 'Assembly Completed' | 'Blocked';
  assigned_craftsman: string;
  parts_checklist: {
    part_id: string;
    part_code: string;
    description: string;
    ready: boolean;
  }[];
  hardware_checklist: {
    item: string;
    quantity: number;
    checked: boolean;
  }[];
  joinery_method: string;
  assembly_notes: string;
}

export interface FinishingJob {
  id: string;
  production_order_id: string;
  production_order_number: string;
  work_item_code: string;
  finish_type: 'High Pressure Laminate (HPL)' | 'Natural Wood Veneer' | 'PU Spray Paint' | 'Clear Lacquer' | 'Powder Coat' | 'Solid Surface';
  specification: string;
  coats_required: number;
  coats_applied: number;
  cure_time_hours: number;
  cured_status: 'Prepping' | 'Application' | 'Curing' | 'Ready for QC';
  assigned_finisher: string;
  inspection_notes?: string;
}

export interface FactoryQCInspection {
  id: string;
  production_order_id: string;
  production_order_number: string;
  work_item_code: string;
  description: string;
  inspector_name: string;
  inspector_role: string;
  inspection_date: string;
  dimensional_tolerance_pass: boolean;
  visual_inspection_pass: boolean;
  hardware_smoothness_pass: boolean;
  edge_banding_integrity_pass: boolean;
  grain_match_pass: boolean;
  result: 'Passed' | 'Failed' | 'Rework Required';
  rework_target_stage?: ProductionOrderStatus;
  rework_reason?: string;
  photos: string[];
  comments: string;
}

export interface PackingPackage {
  id: string;
  package_number: string; // e.g. "PKG-003-1/3"
  production_order_id: string;
  production_order_number: string;
  work_item_code: string;
  project_name: string;
  destination_location: string;
  package_title: string;
  dimensions_mm: string;
  weight_kg: number;
  protection_type: 'Double Corrugated Box + Bubble Wrap' | 'Heavy Foam + Wooden Crate' | 'Edge Corner Protectors + Heavy Stretch Film';
  qr_code: string;
  barcode: string;
  status: 'Packed & Labeled' | 'Stored in Factory Dispatch Bay' | 'Loaded onto Lorry' | 'Ready for Delivery';
  packed_by: string;
  packed_at: string;
}

export interface ProductionIssueRecord {
  id: string;
  issue_code: string; // e.g. "P-ISS-021"
  production_order_id: string;
  production_order_number: string;
  work_item_code: string;
  part_id?: string;
  part_code?: string;
  title: string;
  category: 'Drawing discrepancy' | 'Material defect' | 'Machine breakdown' | 'Missing part' | 'Dimension error' | 'Quality rejection';
  stage_at_occurrence: ProductionOrderStatus;
  severity: 'Low' | 'Medium' | 'High' | 'Critical Blocker';
  status: 'Reported' | 'Investigating' | 'Decision Required' | 'Rework in Progress' | 'Resolved' | 'Closed';
  reported_by: string;
  reported_at: string;
  assigned_to: string;
  escalation_level: 'Factory Foreman' | 'Production Manager' | 'PM' | 'Owner';
  description: string;
  action_plan: string;
  resolution_notes?: string;
  photos: string[];
}

// ----------------------------------------------------
// NW OS MODULE 14: DELIVERY, SITE INSTALLATION & PROJECT COMPLETION
// ----------------------------------------------------

export interface LoadingChecklist {
  correct_project: boolean;
  correct_work_items: boolean;
  correct_quantity: boolean;
  correct_package_count: boolean;
  correct_destination: boolean;
  protection_applied: boolean;
  hardware_accessories_included: boolean;
  delivery_documents_included: boolean;
  loaded_confirmed_by?: string;
  loaded_at?: string;
  photos: string[];
}

export interface DeliveryReceipt {
  id: string;
  delivery_id: string;
  delivery_number: string;
  project_id: string;
  project_name: string;
  receiving_user_id: string;
  receiving_user_name: string;
  receiving_role: string;
  received_at: string;
  condition_status: 'All In Order' | 'Short Quantity' | 'Damaged' | 'Wrong Item' | 'Partially Rejected';
  packages_expected: number;
  packages_received: number;
  damaged_quantity: number;
  missing_quantity: number;
  damage_description?: string;
  missing_description?: string;
  receiver_signature?: string;
  notes?: string;
  photos: string[];
  linked_issue_id?: string;
}

export interface DeliveryRecord {
  id: string;
  delivery_number: string; // e.g. "DEL-2026-008"
  project_id: string;
  project_name: string;
  work_package_id: string;
  work_package_name: string;
  work_item_ids: string[];
  work_item_codes: string[];
  production_order_ids: string[];
  package_ids?: string[];
  contractor_id: string;
  contractor_name: string;
  driver_name: string;
  driver_contact: string;
  vehicle_plate: string; // e.g. "WXX 8892"
  vehicle_type: string; // e.g. "3-Ton Box Lorry (Tail-lift)"
  delivery_date: string; // YYYY-MM-DD
  delivery_time: string; // HH:mm
  estimated_arrival: string; // HH:mm
  destination_site: string;
  special_instructions: string;
  package_count: number;
  status: DeliveryStatus;
  status_history: {
    status: DeliveryStatus;
    timestamp: string;
    changed_by: string;
    notes?: string;
  }[];
  loading_checklist: LoadingChecklist;
  scanned_packages: string[];
  site_receipt?: DeliveryReceipt;
  qr_code: string;
  barcode: string;
  schedule_conflict?: {
    conflict_with_delivery_id: string;
    conflict_with_delivery_number: string;
    conflict_reason: string;
    site_loading_bay: string;
    overlapping_time: string;
  };
  notes?: string;
  photos: string[];
}

export type InstallationJobStatus =
  | 'Not Started'
  | 'Scheduled'
  | 'Site Ready'
  | 'In Progress'
  | 'Blocked'
  | 'Pending Information'
  | 'Awaiting Inspection'
  | 'QC'
  | 'Rectification'
  | 'Delayed'
  | 'Completed'
  | 'Cancelled';

export interface SiteReadinessCheck {
  site_accessible: boolean;
  area_clear: boolean;
  other_trades_completed: boolean;
  power_available: boolean;
  lighting_available: boolean;
  flooring_wall_acceptable: boolean;
  measurements_confirmed: boolean;
  approved_drawings_available: boolean;
  materials_received: boolean;
  tools_equipment_available: boolean;
  safety_requirements_satisfied: boolean;
  result: 'READY' | 'NOT READY' | 'PARTIALLY READY';
  checked_by?: string;
  checked_at?: string;
  notes?: string;
}

export interface SiteMeasurementRecord {
  id: string;
  project_id: string;
  project_name: string;
  work_item_id: string;
  work_item_code: string;
  location: string;
  measurement_value: string; // e.g. "2380mm"
  unit: string; // "mm"
  drawing_reference: string;
  approved_dimension: string; // e.g. "2350mm"
  photo?: string;
  notes?: string;
  submitted_by: string;
  date_time: string;
  is_conflict: boolean;
  conflict_notes?: string;
}

export interface ClientChangeRequest {
  id: string;
  request_code: string; // e.g. "CCR-2026-004"
  project_id: string;
  project_name: string;
  work_item_id: string;
  work_item_code: string;
  current_drawing_rev: string;
  request_details: string;
  requested_change: string;
  photo?: string;
  site_measurement?: string;
  requested_by: string;
  requested_date: string;
  status: 'Pending Review' | 'Costing / Variation Created' | 'Approved' | 'Rejected';
  linked_variation_id?: string;
}

export type QCEvalResult = 'PASS' | 'FAIL' | 'N/A';

export interface SiteQCChecklist {
  dimension: QCEvalResult;
  location: QCEvalResult;
  level: QCEvalResult;
  alignment: QCEvalResult;
  joints: QCEvalResult;
  hardware: QCEvalResult;
  finish: QCEvalResult;
  doors_drawers: QCEvalResult;
  damage: QCEvalResult;
  cleanliness: QCEvalResult;
}

export interface InstallationChecklist {
  level_plumb: boolean;
  secure_fixing: boolean;
  alignment_adjacent: boolean;
  hardware_operation: boolean;
  surface_condition: boolean;
  joint_sealant_tolerances: boolean;
  services_integration: boolean;
  cleanliness_protection: boolean;
  checked_by?: string;
  checked_at?: string;
  notes?: string;
  photos?: string[];
}

export interface SnagItem {
  id: string;
  item_number: number;
  description: string;
  category: 'Surface Blemish' | 'Hardware Adjustment' | 'Alignment / Gap' | 'Sealant & Caulk' | 'Missing Trim';
  severity: 'Minor' | 'Moderate' | 'Critical';
  assigned_to: string;
  deadline: string;
  status: 'Open' | 'Rectification In Progress' | 'Rectified / Ready for Re-inspection' | 'Verified Closed';
  photos_before: string[];
  photos_after?: string[];
  rectified_notes?: string;
}

export interface SiteQCInspection {
  id: string;
  inspection_number: string; // e.g. "SQC-2026-009"
  work_item_id: string;
  work_item_code: string;
  installation_job_id: string;
  project_id: string;
  project_name: string;
  inspector_name: string;
  inspector_role: string;
  inspection_date: string;
  result: 'Pass' | 'Pass with Minor Rectification' | 'Fail / Rectification Required';
  qc_checklist?: SiteQCChecklist;
  level_and_alignment_pass: boolean;
  hardware_and_mechanism_pass: boolean;
  finish_and_surfaces_pass: boolean;
  safety_and_fixing_pass: boolean;
  cleanliness_and_protection_pass: boolean;
  snag_items: SnagItem[];
  inspector_signoff: boolean;
  photos: string[];
  comments: string;
}

export interface InstallationJob {
  id: string;
  job_number: string; // e.g. "INST-2026-004"
  work_item_id: string;
  work_item_code: string;
  work_item_description: string;
  project_id: string;
  project_name: string;
  work_package_id?: string;
  work_package_name?: string;
  location: string;
  contractor_id: string;
  contractor_name: string;
  lead_installer: string;
  installer_contact: string;
  site_supervisor_id: string;
  site_supervisor_name: string;
  team_headcount: number;
  status: InstallationJobStatus;
  planned_start_date: string;
  planned_completion_date: string;
  actual_start_date?: string;
  actual_completion_date?: string;
  drawing_reference: string;
  drawing_revision: string;
  nw_production_drawing_revision?: string;
  installation_instructions?: string;
  site_requirements?: string;
  site_readiness?: SiteReadinessCheck;
  checklist: InstallationChecklist;
  progress_percent: number;
  installed_parts_count?: number;
  total_parts_count?: number;
  delayed_reason?: string;
  notes?: string;
  photos: string[];
}

export interface ProjectCompletionChecklist {
  all_work_items_completed: boolean;
  site_qc_completed: boolean;
  outstanding_issues_reviewed: boolean;
  variations_recorded: boolean;
  client_requests_resolved: boolean;
  required_documents_complete: boolean;
  final_photos_uploaded: boolean;
  defects_rectification_closed: boolean;
  handover_documents_ready: boolean;
  final_claim_status_reviewed: boolean;
}

export interface HandoverRecord {
  id: string;
  project_id: string;
  project_name: string;
  client_id: string;
  client_name: string;
  client_representative: string;
  cpc_certificate_number: string; // e.g. "CPC-NW-2026-PAV-01"
  handover_date: string;
  status: 'Draft' | 'Pending Client Inspection' | 'Conditional Handover' | 'Formal CPC Handover Signed' | 'In DLP Period';
  work_items_included: string[];
  all_site_qc_passed: boolean;
  open_snags_count: number;
  completion_checklist?: ProjectCompletionChecklist;
  client_signoff_name?: string;
  client_signoff_date?: string;
  client_signoff_signature?: string;
  nw_pm_signoff_name: string;
  as_built_drawings_approved: boolean;
  as_built_drawing_revision: string;
  operation_maintenance_manual_ref: string;
  dlp_duration_months: number;
  dlp_start_date: string;
  dlp_end_date: string;
  retention_sum_amount_rm: number;
  retention_sum_status: 'Held in Retention (5%)' | '50% Released at CPC' | 'Fully Released at CMGD';
  cmgd_target_date: string;
  notes?: string;
  documents: { name: string; type: string; date: string; url: string }[];
}

// ----------------------------------------------------
// ROLE-BASED ACCESS CONTROL (RBAC) & PERMISSIONS MODEL
// ----------------------------------------------------
export type PermissionKey =
  // Clients
  | 'clients.view'
  | 'clients.create'
  | 'clients.edit'
  | 'clients.delete'
  // Projects
  | 'projects.view'
  | 'projects.create'
  | 'projects.edit'
  | 'projects.delete'
  // Contractors
  | 'contractors.view'
  | 'contractors.create'
  | 'contractors.edit'
  | 'contractors.delete'
  // Work Packages & Items
  | 'work_packages.view'
  | 'work_packages.create'
  | 'work_packages.edit'
  | 'work_items.view'
  | 'work_items.create'
  | 'work_items.edit'
  | 'work_items.complete'
  | 'work_items.qc'
  | 'work_items.delivery'
  | 'work_items.install'
  // Drawings & Production Knowledge
  | 'drawings.view'
  | 'drawings.upload'
  | 'drawings.markup'
  | 'drawings.analyze'
  | 'drawings.create_production'
  | 'drawings.approve'
  | 'drawings.modify_approved'
  | 'knowledge.view'
  | 'knowledge.edit'
  // Issues & Escalations
  | 'issues.view'
  | 'issues.create'
  | 'issues.assign'
  | 'issues.resolve'
  | 'issues.escalate'
  // Production Management & Shop Floor
  | 'production.view'
  | 'production.update'
  | 'production.create_orders'
  | 'production.cnc_manage'
  | 'production.propose_methods'
  // Delivery & Site Installation (Module 14)
  | 'delivery.view'
  | 'delivery.schedule'
  | 'delivery.load'
  | 'delivery.receive'
  | 'installation.view'
  | 'installation.update'
  | 'installation.qc'
  | 'handover.manage'
  // Purchasing & Materials
  | 'purchasing.view'
  | 'purchasing.create'
  | 'purchasing.manage_suppliers'
  | 'purchasing.manage_pos'
  // Financials, Claims & Costs
  | 'finance.view'
  | 'finance.edit'
  | 'finance.manage_claims'
  | 'finance.record_payments'
  | 'finance.view_margins'
  // Commercial & Profit Control (Module 12)
  | 'commercial.view'
  | 'commercial.costing'
  | 'commercial.margins'
  | 'commercial.edit'
  // Variations
  | 'variations.view'
  | 'variations.create'
  | 'variations.approve'
  | 'variations.client_approve'
  // Approvals Framework
  | 'approvals.view'
  | 'approvals.request'
  | 'approvals.decide'
  | 'approvals.override'
  // Administration & Security
  | 'users.view'
  | 'users.manage'
  | 'settings.manage'
  | 'audit.view'
  | 'ai.assistant'
  | 'workflow.override'
  // Automation, Task & Escalation Engine (Module 15)
  | 'automation.view'
  | 'automation.manage_rules'
  | 'automation.manage_tasks'
  | 'automation.override'
  | 'automation.execute_action'
  // Management Intelligence & Owner Control Center (Module 16)
  | 'management.view'
  | 'management.reports'
  | 'management.kpi_config';

// ----------------------------------------------------
// GENERAL APPROVAL FRAMEWORK
// ----------------------------------------------------
export type ApprovalType =
  | 'Drawing Approval'
  | 'NW Production Drawing Approval'
  | 'Technical Change'
  | 'Variation'
  | 'Major Purchase'
  | 'Major Cost'
  | 'Client Scope Change'
  | 'Project Date Change'
  | 'Safety-Critical Decision';

export type ApprovalDecision = 'Pending' | 'Approved' | 'Rejected' | 'Changes Requested';

export interface ApprovalDocument {
  name: string;
  url: string;
  size?: string;
  type?: string;
}

export interface ApprovalItem {
  id: string;
  approval_number: string; // e.g. "APR-2026-001"
  approval_type: ApprovalType;
  title: string;
  description: string;
  project_id: string;
  project_name: string;
  requested_by_id: string;
  requested_by_name: string;
  requested_by_role: UserRole;
  assigned_approver_role: UserRole | 'Designated Authorized Manager';
  assigned_approver_id?: string;
  assigned_approver_name?: string;
  date_requested: string;
  decision: ApprovalDecision;
  decision_date?: string;
  decision_by_id?: string;
  decision_by_name?: string;
  decision_by_role?: UserRole;
  comments?: string;
  supporting_documents?: ApprovalDocument[];
  impact_summary?: {
    cost_impact_myr?: number;
    schedule_impact_days?: number;
    technical_risk?: 'Low' | 'Medium' | 'High' | 'Critical';
  };
  related_entity_type?: 'drawing' | 'work_item' | 'variation' | 'issue' | 'project' | 'purchase';
  related_entity_id?: string;
  is_owner_override?: boolean;
  override_reason?: string;
  audit_trail?: {
    action: string;
    user_name: string;
    timestamp: string;
    note?: string;
  }[];
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------
// PURCHASING & MATERIAL PROCUREMENT
// ----------------------------------------------------
export interface Supplier {
  id: string;
  name: string;
  category: string; // 'Timber & Plywood' | 'Solid Surface' | 'Hardware & Fittings' | 'Paint & Coatings'
  contact_person: string;
  phone: string;
  email: string;
  rating: number; // 1-5 stars
  payment_terms: string; // '30 Days Net', 'Cash on Delivery'
  is_preferred: boolean;
}

export interface PurchaseOrderItem {
  id: string;
  item_description: string;
  specification: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
}

export type POStatus = 'Draft' | 'Pending Approval' | 'Issued' | 'Partially Received' | 'Goods Received' | 'Completed' | 'Cancelled';

export interface PurchaseOrder {
  id: string;
  po_number: string; // e.g. "PO-2026-042"
  project_id: string;
  project_name: string;
  supplier_id: string;
  supplier_name: string;
  items: PurchaseOrderItem[];
  total_amount: number; // in MYR
  status: POStatus;
  requested_by: string;
  approved_by?: string;
  issued_date?: string;
  expected_delivery_date: string;
  actual_delivery_date?: string;
  notes?: string;
  created_at: string;
}

export interface MaterialRequest {
  id: string;
  request_number: string; // e.g. "MR-2026-018"
  project_id: string;
  project_name: string;
  material_name: string;
  required_quantity: number;
  unit: string;
  needed_by_date: string;
  requested_by: string;
  purpose: string; // e.g. 'Countertop Sub-base for CAR-003'
  status: 'Pending' | 'PO Created' | 'Delivered' | 'Rejected';
  created_at: string;
}

// ----------------------------------------------------
// ACCOUNTING & FINANCIAL TRACKING
// ----------------------------------------------------
export interface FinancialClaim {
  id: string;
  claim_number: string; // e.g. "IPC-01" (Interim Payment Certificate)
  project_id: string;
  project_name: string;
  period_ending: string;
  cumulative_claimed: number;
  retention_amount: number;
  net_claim_amount: number;
  status: 'Draft' | 'Submitted' | 'Certified' | 'Paid';
  certified_amount?: number;
  payment_received_date?: string;
  invoice_number?: string;
}

export interface PaymentRecord {
  id: string;
  reference_no: string;
  project_id: string;
  type: 'Client Inflow' | 'Contractor Outflow' | 'Supplier PO Payment';
  party_name: string;
  amount: number;
  payment_method: 'Online Giro' | 'Cheque' | 'Direct Transfer';
  date: string;
  status: 'Reconciled' | 'Processing';
  notes?: string;
}

// ----------------------------------------------------
// AI COMMUNICATION & CONTRACTOR ASSISTANT
// ----------------------------------------------------
export type AIClassificationType =
  | 'Normal Question'
  | 'Progress Update'
  | 'Completion Update'
  | 'Problem / Issue'
  | 'Delivery Update'
  | 'Delivery Request'
  | 'Measurement'
  | 'Drawing Question'
  | 'Material Question'
  | 'Production Question'
  | 'Installation Question'
  | 'Client Request'
  | 'Variation Request'
  | 'Urgent / Safety Issue'
  | 'General Conversation';

export type AIConfidenceLevel = 'CONFIRMED' | 'PROBABLE' | 'UNKNOWN';

export type MessageChannel = 'web' | 'whatsapp' | 'sms' | 'email';

export interface ChatMessageAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'drawing_ref';
  url: string;
  name: string;
  size?: string;
}

export type AIActionType =
  | 'answer_question'
  | 'update_progress'
  | 'create_issue'
  | 'update_delivery'
  | 'create_qc_task'
  | 'create_variation_request'
  | 'create_material_request'
  | 'request_pm_review'
  | 'request_site_supervisor_review'
  | 'request_production_manager_review'
  | 'escalate'
  | 'ask_clarification';

export interface AIActionRecord {
  action_id: string;
  message_id: string;
  action_type: AIActionType;
  target_record: string; // e.g. "WorkItem CAR-003", "Issue ISS-004"
  target_record_id?: string;
  previous_value?: string;
  new_value?: string;
  confidence: AIConfidenceLevel;
  executed_by: string; // 'NW OS AI Assistant' or human user
  execution_time: string;
  approval_required: boolean;
  approval_status: 'auto_executed' | 'pending_pm' | 'pending_owner' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  notes?: string;
}

export interface ChatMessage {
  id: string;
  channel: MessageChannel;
  sender_id: string;
  sender_name: string;
  sender_role: UserRole;
  project_id: string;
  project_name?: string;
  work_package_id?: string;
  work_item_id?: string;
  work_item_code?: string;
  message_text: string;
  language?: 'en' | 'ms' | 'zh' | 'mixed';
  attachments?: ChatMessageAttachment[];
  timestamp: string;
  is_ai_response?: boolean;
  ai_classification?: AIClassificationType;
  ai_confidence?: AIConfidenceLevel;
  ai_action?: string;
  ai_action_id?: string;
  status: 'sent' | 'delivered' | 'processed' | 'needs_human_action' | 'resolved';
  routed_to?: 'AI' | 'Site Supervisor' | 'PM' | 'Production Manager' | 'Owner';
  human_response_needed?: boolean;
  human_resolved?: boolean;
}

export interface PMInboxItem {
  id: string;
  message_id: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  project_id: string;
  project_name: string;
  contractor_name: string;
  work_item_code?: string;
  original_message: string;
  ai_interpretation: string;
  recommended_action: string;
  category: AIClassificationType;
  created_at: string;
  status: 'pending' | 'resolved' | 'escalated';
  related_issue_id?: string;
  related_variation_id?: string;
}

export interface OwnerDailyBriefing {
  date: string;
  today_items: Array<{ title: string; detail: string; priority: 'CRITICAL' | 'HIGH' | 'NORMAL' }>;
  risks: Array<{ project_name: string; reason: string; risk_level: string }>;
  decisions: Array<{ id: string; title: string; category: string; amount?: string; deadline: string }>;
  contractors: Array<{ contractor: string; issue: string; project: string }>;
  drawings: Array<{ drawing: string; revision: string; impact: string }>;
  delivery: Array<{ item: string; time: string; site: string }>;
  finance: Array<{ variation_number: string; amount: number; title: string }>;
}

// ----------------------------------------------------
// WHATSAPP-READY COMMUNICATION GATEWAY ARCHITECTURE
// ----------------------------------------------------

export type GatewayChannel = 'NW_OS' | 'WHATSAPP' | 'EMAIL' | 'SMS' | 'FUTURE';

export type GatewayDirection = 'INBOUND' | 'OUTBOUND';

export type GatewayDeliveryStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export type GatewayAIConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type GatewayIntent =
  | 'QUESTION'
  | 'PROGRESS_UPDATE'
  | 'COMPLETION'
  | 'PROBLEM'
  | 'DELIVERY'
  | 'MEASUREMENT'
  | 'DRAWING_QUESTION'
  | 'MATERIAL_QUESTION'
  | 'PRODUCTION_QUESTION'
  | 'INSTALLATION'
  | 'VARIATION'
  | 'CLIENT_REQUEST'
  | 'URGENT'
  | 'GENERAL';

export type GatewayConversationOwner =
  | 'AI'
  | 'Site Supervisor'
  | 'PM'
  | 'Production Manager'
  | 'Owner';

export interface GatewayAttachment {
  file_id: string;
  original_filename: string;
  file_type: 'image' | 'pdf' | 'dwg' | 'excel' | 'audio' | 'document';
  file_url: string;
  file_size?: string;
  sender: string;
  sender_id?: string;
  project_id?: string;
  work_package_id?: string;
  work_item_id?: string;
  message_id?: string;
  upload_date: string;
  access_permissions: string[];
}

export interface GatewayMessage {
  message_id: string;
  channel: GatewayChannel;
  direction: GatewayDirection;
  sender_user_id?: string;
  sender_phone?: string;
  sender_name: string;
  recipient_user_id?: string;
  recipient_phone?: string;
  project_id?: string;
  project_name?: string;
  work_package_id?: string;
  work_item_id?: string;
  work_item_code?: string;
  issue_id?: string;
  message_text: string;
  attachments?: GatewayAttachment[];
  timestamp: string;
  ai_classification?: GatewayIntent | string;
  ai_confidence?: GatewayAIConfidence;
  ai_status?:
    | 'PROCESSED'
    | 'PENDING_HUMAN'
    | 'BLOCKED_PERMISSION'
    | 'UNKNOWN_CONTACT'
    | 'ESCALATED'
    | 'HUMAN_RESOLVED';
  related_record?: string;
  delivery_status: GatewayDeliveryStatus;
  external_message_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CommunicationContact {
  contact_id: string;
  user_id?: string;
  contractor_id?: string;
  client_id?: string;
  name: string;
  role: UserRole | string;
  company_name: string;
  phone_number: string; // e.g. "+60 12-398 5566"
  email: string;
  preferred_language: 'en' | 'ms' | 'zh' | 'mixed';
  preferred_channel: GatewayChannel;
  whatsapp_enabled: boolean;
  status: 'active' | 'pending_verification' | 'disabled';
  verified: boolean;
  assigned_project_ids: string[];
  assigned_trade_packages: string[];
  created_at: string;
  updated_at: string;
}

export interface ConversationThread {
  thread_id: string;
  channel: GatewayChannel;
  contact_id: string;
  contact_phone: string;
  contact_name: string;
  project_id?: string;
  project_name?: string;
  work_package_id?: string;
  work_item_id?: string;
  work_item_code?: string;
  status: 'active' | 'waiting_human' | 'waiting_contractor' | 'resolved' | 'escalated';
  last_message_at: string;
  last_message_preview: string;
  assigned_to: GatewayConversationOwner;
  language: 'en' | 'ms' | 'zh' | 'mixed';
  escalation_deadline?: string;
  unread_count: number;
  messages_count: number;
}

export interface MessageQueueItem {
  queue_id: string;
  message_id: string;
  channel: GatewayChannel;
  recipient: string;
  recipient_name: string;
  content: string;
  attachments?: GatewayAttachment[];
  status: GatewayDeliveryStatus;
  retry_count: number;
  scheduled_at: string;
  sent_at?: string;
  external_message_id?: string;
  error_message?: string;
  trigger_event?: string;
}

export interface AIActionRequest {
  id: string;
  thread_id?: string;
  message_id?: string;
  project_id: string;
  project_name: string;
  work_item_code?: string;
  sender_name: string;
  sender_phone: string;
  original_message: string;
  ai_interpretation: string;
  recommended_action: string;
  action_type: string;
  reason: string;
  confidence: GatewayAIConfidence;
  supporting_drawings?: string[];
  supporting_docs?: string[];
  status: 'pending' | 'approved' | 'rejected' | 'more_info_requested';
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
}

export interface GatewaySettings {
  supported_channels: {
    whatsapp: boolean;
    email: boolean;
    sms: boolean;
    nw_os: boolean;
  };
  default_language: 'en' | 'ms' | 'zh' | 'mixed';
  ai_enabled: boolean;
  escalation_timers: {
    normal_hours: number;
    high_hours: number;
    critical_immediate: boolean;
  };
  auto_qc_creation: boolean;
  auto_progress_update: boolean;
  require_human_approval_for_variation: boolean;
  require_human_approval_for_dimension_change: boolean;
  owner_protection_strict: boolean;
  templates: Array<{
    id: string;
    name: string;
    channel: GatewayChannel;
    text: string;
  }>;
}

export interface GatewayMetrics {
  total_messages: number;
  ai_answered: number;
  ai_actions_executed: number;
  human_handoffs: number;
  escalations: number;
  clarification_requests: number;
  failed_responses: number;
  unrecognized_contacts: number;
  avg_response_time_seconds: number;
  high_confidence_count: number;
  medium_confidence_count: number;
  low_confidence_count: number;
  human_override_count: number;
}

export interface SimulationTrace {
  inbound: GatewayMessage;
  sender_verification: {
    recognized: boolean;
    contact?: CommunicationContact;
    assigned_projects: string[];
    assigned_trades: string[];
    authorized: boolean;
    auth_reason: string;
  };
  ai_interpretation: {
    item_code?: string;
    work_item_id?: string;
    intent: GatewayIntent | string;
    confidence: GatewayAIConfidence;
    reason: string;
    clarification_prompt?: string;
  };
  decision_gate: {
    can_ai_execute: boolean;
    action_name: string;
    requires_human_approval: boolean;
    blocked_reason?: string;
  };
  system_action?: {
    executed: boolean;
    description: string;
    target_record?: string;
  };
  outbound_message?: GatewayMessage;
  queue_item?: MessageQueueItem;
  audit_logged: boolean;
}

export interface SecurityTestCase {
  id: string;
  title: string;
  description: string;
  sender_label: string;
  sender_phone: string;
  message_input: string;
  expected_outcome: string;
  status?: 'PASSED' | 'FAILED' | 'NOT_RUN';
  actual_outcome?: string;
  execution_details?: string;
}

// ----------------------------------------------------
// COMMERCIAL, COSTING & PROFIT CONTROL ARCHITECTURE
// ----------------------------------------------------

export type QuotationStatus =
  | 'Draft'
  | 'Internal Review'
  | 'Submitted'
  | 'Negotiation'
  | 'Accepted'
  | 'Rejected'
  | 'Expired'
  | 'Superseded';

export type CostSource =
  | 'Material Price'
  | 'Supplier Quote'
  | 'Historical Cost'
  | 'Contractor Quote'
  | 'Manual Estimate'
  | 'AI Suggestion';

export type CostConfidenceLevel =
  | 'CONFIRMED'
  | 'ESTIMATED'
  | 'HISTORICAL'
  | 'AI ESTIMATE'
  | 'PENDING QUOTE';

export type QuotationItemUnit =
  | 'pcs'
  | 'set'
  | 'unit'
  | 'mm'
  | 'm'
  | 'ft'
  | 'sqft'
  | 'sqm'
  | 'kg'
  | 'lot';

export interface QuotationItemCostBreakdown {
  material: number;
  labour: number;
  subcontractor: number;
  hardware: number;
  transport: number;
  installation: number;
  equipment: number;
  other_direct: number;
}

export interface QuotationItem {
  id: string;
  item_code: string; // e.g. "CAR-003"
  description: string;
  category: string;
  specification: string;
  quantity: number;
  unit: QuotationItemUnit;
  length?: number; // mm
  width?: number; // mm
  height?: number; // mm
  area?: number; // sqft
  volume?: number;
  unit_selling_price: number;
  total_selling_price: number;
  estimated_cost_breakdown: QuotationItemCostBreakdown;
  total_estimated_cost: number;
  gross_profit: number;
  gross_margin_percent: number;
  cost_source: CostSource;
  cost_confidence: CostConfidenceLevel;
  supplier_reference?: string;
  contractor_reference?: string;
  notes?: string;
}

export interface CommercialQuotation {
  id: string;
  quotation_number: string; // e.g. "QT-2026-088"
  version: number; // 1, 2, 3
  version_code: string; // "QT-2026-088-V1"
  client_id: string;
  client_name: string;
  enquiry_id?: string;
  tender_id?: string;
  project_id?: string;
  project_name: string;
  date: string;
  validity_days: number;
  valid_until: string;
  prepared_by: string;
  status: QuotationStatus;
  items: QuotationItem[];
  subtotal_selling_price: number;
  tax_applicable: boolean;
  tax_rate: number;
  tax_amount: number;
  total_selling_price: number;
  // Internal costing (HIDDEN from clients)
  total_estimated_cost: number;
  estimated_gross_profit: number;
  estimated_gross_margin_percent: number;
  approval_status: 'Pending' | 'Approved' | 'Requires Management Review';
  low_margin_warning?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientEnquiry {
  id: string;
  enquiry_number: string; // e.g. "ENQ-2026-015"
  client_id: string;
  client_name: string;
  project_name: string;
  scope_description: string;
  budget_expectation?: number;
  received_date: string;
  target_submission_date: string;
  status: 'New' | 'Reviewing' | 'Tender Invited' | 'Quoted' | 'Won' | 'Lost' | 'Cancelled';
  assigned_estimator: string;
  notes?: string;
}

export interface CommercialTender {
  id: string;
  tender_number: string; // e.g. "TDR-2026-008"
  enquiry_id?: string;
  client_id: string;
  client_name: string;
  project_name: string;
  submission_deadline: string;
  bond_required?: boolean;
  bond_amount?: number;
  estimated_value: number;
  status: 'In Preparation' | 'Submitted' | 'Shortlisted' | 'Awarded' | 'Regretted' | 'Lost';
  documents: string[];
  assigned_lead: string;
}

export interface PriceDatabaseRecord {
  id: string;
  type: 'Material' | 'Contractor Rate' | 'Equipment';
  item_name: string;
  category: string;
  supplier_or_contractor: string;
  unit: string;
  price: number;
  currency: string;
  date: string;
  project_reference?: string;
  specification?: string;
  trend?: 'up' | 'down' | 'stable';
  previous_price?: number;
  historical_range?: { min: number; max: number };
}

export type CostCategory =
  | 'Material'
  | 'Subcontractor'
  | 'Labour'
  | 'Logistics'
  | 'Site'
  | 'Other Direct Cost';

export interface ProjectCostAllocation {
  project_id: string;
  project_name: string;
  allocated_amount: number;
}

export interface ProjectCostLedgerItem {
  cost_id: string;
  project_id: string;
  project_name: string;
  work_package_id?: string;
  work_package_name?: string;
  work_item_id?: string;
  work_item_code?: string;
  cost_category: CostCategory;
  party_name: string; // Supplier or Contractor
  po_reference?: string;
  invoice_reference?: string;
  description: string;
  amount: number;
  date: string;
  status: 'Committed' | 'Incurred' | 'Reconciled' | 'Disputed';
  cost_source: string;
  created_by: string;
  approved_by?: string;
  allocation_details?: ProjectCostAllocation[];
  notes?: string;
}

export interface ProjectCommercialBaseline {
  project_id: string;
  project_number: string;
  project_name: string;
  original_contract_value: number;
  approved_variations_total: number;
  current_contract_value: number; // original + approved
  unapproved_potential_variations_total: number;
  estimated_final_revenue: number; // current + expected
  original_budget_direct_cost: number;
  committed_cost: number; // approved POs + subcontracts
  actual_cost: number; // confirmed incurred
  forecast_final_cost: number;
  cost_variance: number; // forecast - budget
  cost_variance_status: 'On Budget' | 'Minor Variance' | 'Forecast Over Budget' | 'Critical Overrun';
  variance_drivers: {
    material: number;
    subcontractor: number;
    rework: number;
    logistics: number;
    other: number;
  };
  cash_billed: number;
  cash_collected: number;
  cash_outstanding: number;
  current_gross_profit: number; // current revenue - actual cost
  forecast_gross_profit: number; // current contract value - forecast final cost
  forecast_gross_margin_percent: number;
}

export interface GoodsReceivedRecord {
  id: string;
  grn_number: string; // "GRN-2026-031"
  supplier_id: string;
  supplier_name: string;
  po_id: string;
  po_number: string;
  project_id: string;
  project_name: string;
  material_description: string;
  quantity_received: number;
  unit: string;
  date_received: string;
  received_by: string;
  delivery_note_number: string;
  condition: 'Good' | 'Damaged / Rejected' | 'Partial with Shortage';
  invoice_reference?: string;
  notes?: string;
}

export interface CommercialInvoice {
  id: string;
  invoice_number: string;
  invoice_type: 'Supplier Invoice' | 'Subcontractor Claim Invoice' | 'Client Billing Invoice';
  party_name: string;
  project_id: string;
  project_name: string;
  po_reference?: string;
  claim_reference?: string;
  amount_before_tax: number;
  tax_amount: number;
  total_amount: number;
  invoice_date: string;
  due_date: string;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Partially Paid' | 'Paid' | 'Overdue';
  paid_amount: number;
  notes?: string;
}

export interface CostLeakAlert {
  id: string;
  project_id: string;
  project_name: string;
  type:
    | 'PURCHASE PRICE INCREASE'
    | 'UNPLANNED PURCHASE'
    | 'DUPLICATE PURCHASE'
    | 'COST ABOVE ESTIMATE'
    | 'LOW MARGIN'
    | 'REWORK COST'
    | 'UNBILLED VARIATION';
  title: string;
  description: string;
  impact_amount: number;
  detected_date: string;
  severity: 'Critical' | 'Warning' | 'Info';
  action_suggested: string;
  status: 'Identified' | 'Under Review' | 'Resolved';
}

export interface ProjectCashflowEntry {
  id: string;
  project_id: string;
  period: string; // e.g. "Oct 2026"
  expected_inflow: number;
  actual_inflow: number;
  expected_outflow: number;
  actual_outflow: number;
  net_cash_movement: number;
  notes?: string;
}

// ----------------------------------------------------
// NW OS MODULE 15: AUTOMATION, TASK, NOTIFICATION & ESCALATION ENGINE
// ----------------------------------------------------

export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent' | 'Critical';

export type TaskStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting'
  | 'Completed'
  | 'Cancelled'
  | 'Escalated'
  | 'Blocked';

export type TaskSourceModule =
  | 'AI'
  | 'Contractor'
  | 'Site Supervisor'
  | 'PM'
  | 'Production'
  | 'Purchasing'
  | 'Accountant'
  | 'Client'
  | 'System Automation'
  | 'Approval'
  | 'Drawing Revision'
  | 'QC'
  | 'Variation'
  | 'Delivery'
  | 'Installation'
  | 'Finance';

export type TaskEscalationLevel = 'None' | 'Site Supervisor' | 'PM' | 'Owner';

export interface TaskComment {
  id: string;
  user_name: string;
  role: string;
  text: string;
  timestamp: string;
}

export interface TaskAttachment {
  name: string;
  url: string;
  type: 'photo' | 'document';
}

export interface NWTask {
  id: string;
  task_number: string; // e.g. "TSK-2026-081"
  title: string;
  description: string;
  project_id: string;
  project_name: string;
  work_package_id?: string;
  work_package_name?: string;
  work_item_id?: string;
  work_item_code?: string;
  source_event: string;
  source_module: TaskSourceModule;
  source_reason?: string;
  assigned_user_id: string;
  assigned_user_name: string;
  assigned_role: UserRole;
  priority: TaskPriority;
  due_date: string;
  due_time?: string;
  status: TaskStatus;
  waiting_for_party?: string;
  created_date: string;
  completed_date?: string;
  escalation_level: TaskEscalationLevel;
  is_critical?: boolean;
  requires_acknowledgement?: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
  dependency_task_ids?: string[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  next_best_action?: {
    recommendation: string;
    confidence: 'CONFIRMED' | 'PROBABLE' | 'UNKNOWN';
    suggested_action: string;
    is_high_risk: boolean;
  };
}

export type AutomationEventType =
  | 'project.created'
  | 'project.awarded'
  | 'project.starting_soon'
  | 'drawing.uploaded'
  | 'drawing.revision_uploaded'
  | 'drawing.approval_requested'
  | 'drawing.approved'
  | 'drawing.superseded'
  | 'work_item.created'
  | 'work_item.assigned'
  | 'work_item.contractor_accepted'
  | 'work_item.work_started'
  | 'work_item.work_completed'
  | 'qc.passed'
  | 'qc.failed'
  | 'purchasing.material_shortage'
  | 'purchasing.po_created'
  | 'purchasing.goods_received'
  | 'production.blocked'
  | 'production.completed'
  | 'production.item_packed'
  | 'production.ready_for_delivery'
  | 'delivery.scheduled'
  | 'delivery.received'
  | 'installation.scheduled'
  | 'installation.started'
  | 'installation.blocked'
  | 'installation.site_qc_failed'
  | 'variation.created'
  | 'client.request_received'
  | 'invoice.issued'
  | 'payment.overdue'
  | 'issue.created'
  | 'issue.unresolved'
  | 'issue.critical_created'
  | 'approval.requested';

export interface AutomationEvent {
  id: string;
  event_type: AutomationEventType;
  source_module: string;
  source_record: string;
  project_id: string;
  work_item_id?: string;
  user_id: string;
  timestamp: string;
  event_data: Record<string, any>;
  processed: boolean;
  idempotency_key: string;
}

export interface AutomationRuleCondition {
  field: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'before'
    | 'after'
    | 'is_empty'
    | 'is_not_empty';
  value: any;
}

export type AutomationRuleActionType =
  | 'create_task'
  | 'assign_task'
  | 'change_status'
  | 'send_notification'
  | 'send_whatsapp'
  | 'send_email'
  | 'create_issue'
  | 'create_approval'
  | 'create_material_request'
  | 'create_qc_task'
  | 'create_variation_review'
  | 'escalate'
  | 'add_tag'
  | 'create_ai_briefing'
  | 'request_human_review';

export interface AutomationRuleAction {
  action_type: AutomationRuleActionType;
  target_role?: UserRole;
  target_user_id?: string;
  template_title?: string;
  template_message?: string;
  priority?: TaskPriority;
  deadline_hours?: number;
  escalate_to_role?: UserRole;
  requires_human_approval?: boolean;
}

export interface AutomationRule {
  id: string;
  rule_code: string; // e.g. "RULE-01"
  name: string;
  description: string;
  trigger_event: AutomationEventType;
  conditions: AutomationRuleCondition[];
  condition_logic: 'AND' | 'OR';
  actions: AutomationRuleAction[];
  assign_to_role: UserRole;
  deadline_hours: number;
  escalate_to_role: UserRole;
  is_active: boolean;
  is_draft: boolean;
  priority: TaskPriority;
  applies_to_projects: string[]; // 'all' or project IDs
  created_by: string;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  rule_id: string;
  rule_name: string;
  event_id: string;
  event_type: string;
  status: 'Success' | 'Failed' | 'Retrying' | 'Requires Human Approval';
  started_at: string;
  completed_at?: string;
  result_description: string;
  error?: string;
  retry_count: number;
  max_retries: number;
  idempotency_key: string;
}

export interface FailedAutomation {
  id: string;
  run_id: string;
  rule_id: string;
  rule_name: string;
  error_reason: string;
  failure_category:
    | 'Missing Recipient'
    | 'WhatsApp Gateway Failed'
    | 'Permission Denied'
    | 'Task Dependency Blocked'
    | 'Validation Error';
  failed_at: string;
  retry_attempts: number;
  can_retry_manually: boolean;
  is_resolved: boolean;
}

export interface EscalationRecord {
  id: string;
  escalation_number: string; // e.g. "ESC-2026-014"
  source_record_type: 'Task' | 'Issue' | 'Approval' | 'WorkItem' | 'Payment';
  source_record_id: string;
  project_id: string;
  project_name: string;
  title: string;
  reason: string;
  previous_level: TaskEscalationLevel;
  current_level: TaskEscalationLevel;
  assigned_role: UserRole;
  assigned_user_name: string;
  is_critical: boolean;
  requires_acknowledgement: boolean;
  acknowledged_at?: string;
  acknowledged_by?: string;
  created_at: string;
  resolved_at?: string;
  resolution_action?: string;
}

export type NotificationCategory =
  | 'Task'
  | 'Approval'
  | 'Issue'
  | 'Escalation'
  | 'Drawing'
  | 'Production'
  | 'Delivery'
  | 'Installation'
  | 'QC'
  | 'Commercial'
  | 'Client'
  | 'System';

export type NotificationChannel = 'in_app' | 'whatsapp' | 'email' | 'sms' | 'push';

export interface UserNotificationPreference {
  user_id: string;
  category_preferences: Record<
    NotificationCategory,
    {
      in_app: boolean;
      whatsapp: boolean;
      email: boolean;
      push: boolean;
    }
  >;
  daily_briefing_channel: NotificationChannel;
  daily_briefing_time: string;
}

export interface DailyBriefing {
  id: string;
  user_id: string;
  user_role: UserRole;
  date: string;
  summary: string;
  metrics: {
    tasks_due_today: number;
    tasks_overdue: number;
    critical_issues: number;
    blocked_production: number;
    deliveries_today: number;
    installations_today: number;
    approvals_pending: number;
    decisions_required_count?: number;
    projects_at_risk_count?: number;
    cash_cost_risks_count?: number;
  };
  focus_items: {
    category: 'DECISION' | 'AT_RISK' | 'CRITICAL' | 'COMMERCIAL' | 'PRODUCTION' | 'SITE';
    title: string;
    project_code: string;
    action_needed: string;
    urgency: 'High' | 'Critical' | 'Normal';
  }[];
}

export interface WorkflowTemplate {
  id: string;
  code: 'SUPERMARKET_NEW_OUTLET' | 'SUPERMARKET_MAINTENANCE' | 'COMMERCIAL_FITOUT';
  name: string;
  description: string;
  stages: {
    step_order: number;
    phase_name: string;
    action_type: string;
    default_role: UserRole;
    checklist: string[];
  }[];
}

export interface OwnerOverrideRecord {
  id: string;
  overridden_by: string;
  overridden_by_role: UserRole;
  timestamp: string;
  reason: string;
  affected_record_type: string;
  affected_record_id: string;
  previous_rule_state: string;
  new_decision: string;
}

export interface BusinessCalendarConfig {
  working_days: number[]; // 1=Mon, 2=Tue, ..., 6=Sat
  working_hours_start: string; // "08:30"
  working_hours_end: string; // "18:00"
  holidays: { date: string; name: string }[];
  project_calendar_overrides: Record<
    string,
    { weekend_work_allowed: boolean; night_shift_allowed: boolean }
  >;
}

// ====================================================
// MODULE 16: MANAGEMENT INTELLIGENCE & OWNER CONTROL
// ====================================================

export type SalesPipelineStage =
  | 'Enquiry'
  | 'Tender'
  | 'Quotation'
  | 'Negotiation'
  | 'Awaiting Award'
  | 'Awarded'
  | 'Lost'
  | 'Cancelled';

export interface SalesPipelineDeal {
  id: string;
  deal_number: string; // e.g. "DEAL-2026-012"
  title: string;
  client_id: string;
  client_name: string;
  client_contact: string;
  stage: SalesPipelineStage;
  estimated_value: number; // Potential future business (NOT recognized as revenue!)
  user_entered_probability?: number; // Clearly labeled as user-entered percentage
  age_days: number;
  expected_award_date: string;
  next_action: string;
  next_action_due: string;
  responsible_person: string;
  responsible_role: UserRole;
  scope_summary: string;
  notes?: string;
  quotation_id?: string;
  created_at: string;
  updated_at: string;
}

export type ProjectRiskLevel = 'On Track' | 'Attention' | 'At Risk' | 'Critical';

export interface ProjectHealthDimension {
  status: ProjectRiskLevel;
  evidence: string[];
}

export interface ProjectHealthBreakdown {
  progress: ProjectHealthDimension; // Physical progress
  schedule: ProjectHealthDimension; // Schedule status
  commercial: ProjectHealthDimension; // Contract vs cost
  production: ProjectHealthDimension; // Factory status
  site: ProjectHealthDimension; // Installation status
  issues: ProjectHealthDimension; // Open issues
  client: ProjectHealthDimension; // Outstanding requests
  cash: ProjectHealthDimension; // Claims/payment status
}

export interface ManagementAlert {
  id: string;
  level: 'Info' | 'Attention' | 'At Risk' | 'Critical';
  title: string;
  category:
    | 'Schedule'
    | 'Commercial'
    | 'Production'
    | 'Delivery'
    | 'Installation'
    | 'Client'
    | 'Contractor'
    | 'Material'
    | 'Technical'
    | 'Safety'
    | 'Contractual';
  evidence: string[];
  affected_record_type: string;
  affected_record_id: string;
  project_id?: string;
  project_name?: string;
  recommended_action: string;
  created_at: string;
  resolved: boolean;
}

export interface OwnerDecisionRecord {
  id: string;
  type:
    | 'Variation Approval'
    | 'Drawing Decision'
    | 'Client Scope Request'
    | 'Major Commercial PO'
    | 'Production Method Waiver';
  title: string;
  project_id: string;
  project_name: string;
  financial_impact?: number;
  deadline: string;
  reason: string;
  recommended_action: string;
  source_documents: string[];
  status: 'Pending' | 'Approved' | 'Rejected' | 'Changes Requested' | 'Delegated';
  delegated_to?: string;
  decision_notes?: string;
  decided_at?: string;
  created_at: string;
}

export interface OwnerDependencyMonthly {
  month: string; // e.g. "September 2026", "October 2026"
  total_interventions: number;
  contractor_questions: number;
  drawing_decisions: number;
  site_issues: number;
  commercial_approvals: number;
  client_requests: number;
  production_problems: number;
  purchasing: number;
  administration: number;
}

export interface RecurringProblemPattern {
  id: string;
  problem_title: string;
  category: string;
  occurrence_count: number;
  affected_projects: string[];
  affected_project_names: string[];
  sample_evidence: string[];
  ai_suggestion: string;
  status: 'Open' | 'Knowledge Draft Created' | 'Ignored' | 'Investigating';
  detected_date: string;
}

export interface ProcessImprovementProposal {
  id: string;
  title: string;
  category:
    | 'Checklist'
    | 'Automation'
    | 'Approval Rule'
    | 'Production Method'
    | 'Contractor Instruction'
    | 'Drawing Standard'
    | 'Client Workflow';
  reason: string;
  expected_benefit: string;
  affected_stage: string;
  status: 'Proposed' | 'Implemented' | 'Dismissed';
  suggested_by: string;
  created_at: string;
}

export interface ManagementKPIThresholds {
  quotation_response_days: number; // e.g. 3 days
  min_gross_margin_percent: number; // e.g. 25%
  max_production_lead_days: number; // e.g. 14 days
  max_qc_failure_rate_percent: number; // e.g. 5%
  max_delivery_issue_percent: number; // e.g. 2%
  max_receivable_overdue_days: number; // e.g. 30 days
  max_monthly_owner_interventions: number; // e.g. 45
}




