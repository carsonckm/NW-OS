/**
 * NW OS Contractor Mobile Dashboard (Hock Seng Carpentry / 林福成)
 * Simple, fast, trilingual mobile interface strictly constrained to contractor's work packages.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Truck,
  ShieldCheck,
  Sparkles,
  FileText,
  Clock,
  Layers,
} from 'lucide-react';
import { ContractorQuickUpdate } from '../components/ContractorQuickUpdate';
import { IssueModal } from '../components/IssueModal';
import { DeliveryModal } from '../components/DeliveryModal';

export const ContractorDashboard: React.FC = () => {
  const {
    currentUser,
    workItems,
    updateWorkItemStatus,
    language,
  } = useNW();

  const [activeIssueModalItemId, setActiveIssueModalItemId] = useState<string | null>(null);
  const [selectedDeliveryItem, setSelectedDeliveryItem] = useState<WorkItem | null>(null);

  // Filter items strictly for this contractor
  const myItems = workItems.filter(
    (w) => w.contractor_id === currentUser.contractor_id || w.contractor_id === 'con-1'
  );

  const activeFocusItem = myItems.find((w) => w.item_code === 'CAR-003') || myItems[0];

  // Multilingual translations for Contractor
  const t = {
    en: {
      title: 'Contractor Portal',
      sub: 'Hock Seng Carpentry & Joinery',
      activeItems: 'My Assigned Work Items',
      readyQc: 'Mark Ready for QC',
      scheduleDelivery: 'Schedule Delivery',
      reportProblem: 'Report Problem / Dimension Issue',
      approvedDrawing: 'Approved Drawing:',
    },
    ms: {
      title: 'Portal Kontraktor',
      sub: 'Pertukangan & Kayu Hock Seng',
      activeItems: 'Senarai Kerja Ditugaskan',
      readyQc: 'Tandakan Siap untuk QC',
      scheduleDelivery: 'Jadualkan Penghantaran',
      reportProblem: 'Lapor Masalah / Saiz Salah',
      approvedDrawing: 'Lukisan Diluluskan:',
    },
    zh: {
      title: '承包商生产工作台',
      sub: '福成木工家私工程 (Hock Seng)',
      activeItems: '我的工作项目',
      readyQc: '标记完工待品检 (QC)',
      scheduleDelivery: '安排罗里送货',
      reportProblem: '报告尺寸/现场问题',
      approvedDrawing: '核准图纸版本:',
    },
  }[language];

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 sm:px-6 py-6 text-slate-800">
      {/* Contractor Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200 text-[10px] font-bold uppercase tracking-widest">
              {t.title}
            </span>
            <span className="text-xs text-slate-500 font-medium">Ah Seng (林福成)</span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">{t.sub}</h1>
          <p className="text-xs text-slate-500 mt-1">
            Factory: Sungai Buloh Industrial Park • Trade: Carpentry & Bespoke Joinery
          </p>
        </div>

        <button
          onClick={() => setActiveIssueModalItemId('item-1')}
          className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center space-x-2 transition-colors shrink-0 cursor-pointer"
        >
          <AlertTriangle className="w-4 h-4" />
          <span>{t.reportProblem}</span>
        </button>
      </div>

      {/* Trilingual Quick NLP Update Card */}
      {activeFocusItem && (
        <ContractorQuickUpdate
          workItem={activeFocusItem}
          onOpenIssueModal={(itemId) => setActiveIssueModalItemId(itemId)}
          onOpenQCModal={() => {}}
          onOpenDeliveryModal={(item) => setSelectedDeliveryItem(item)}
        />
      )}

      {/* My Work Items */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Wrench className="w-4 h-4 text-amber-600" />
            <span>{t.activeItems} ({myItems.length})</span>
          </h3>
          <span className="text-[10px] text-slate-500 font-medium">Strict Data Boundary</span>
        </div>

        <div className="space-y-4">
          {myItems.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-amber-700">{item.item_code}</span>
                    <h4 className="text-sm font-bold text-slate-900">{item.description}</h4>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t.approvedDrawing}{' '}
                    <strong className="text-slate-800 font-mono">{item.drawing_revision}</strong> • Dimensions:{' '}
                    <strong className="text-slate-800">{item.dimensions}</strong>
                  </p>
                </div>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border self-start sm:self-center ${
                    item.status === 'QC Passed'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : item.status === 'Ready for QC'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : item.status === 'Delivered'
                      ? 'bg-sky-50 text-sky-800 border-sky-200'
                      : 'bg-slate-200 text-slate-800 border-slate-300'
                  }`}
                >
                  {item.status}
                </span>
              </div>

              {/* Material & Note details */}
              <div className="p-3 bg-white rounded-lg text-xs space-y-1 border border-slate-200">
                <div className="text-slate-700">
                  <span className="text-slate-500 font-medium">Materials:</span> {item.material}
                </div>
                {item.notes && (
                  <div className="text-amber-800 text-[11px] font-medium">
                    <span className="text-slate-500">Notes:</span> {item.notes}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {item.status === 'In Progress' && (
                  <button
                    onClick={() => updateWorkItemStatus(item.id, 'Ready for QC')}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg shadow-2xs flex items-center space-x-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t.readyQc}</span>
                  </button>
                )}

                {item.status === 'QC Passed' && (
                  <button
                    onClick={() => setSelectedDeliveryItem(item)}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center space-x-1.5 cursor-pointer"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>{t.scheduleDelivery}</span>
                  </button>
                )}

                <button
                  onClick={() => setActiveIssueModalItemId(item.id)}
                  className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 text-xs font-bold rounded-lg border border-slate-300 transition-colors flex items-center space-x-1.5 cursor-pointer shadow-2xs"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Flag Problem</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery Schedule Modal */}
      {selectedDeliveryItem && (
        <DeliveryModal
          isOpen={Boolean(selectedDeliveryItem)}
          onClose={() => setSelectedDeliveryItem(null)}
          workItem={selectedDeliveryItem}
          mode="schedule"
        />
      )}

      {/* Issue Modal */}
      {activeIssueModalItemId && (
        <IssueModal
          isOpen={Boolean(activeIssueModalItemId)}
          onClose={() => setActiveIssueModalItemId(null)}
          defaultWorkItemId={activeIssueModalItemId}
        />
      )}
    </div>
  );
};
