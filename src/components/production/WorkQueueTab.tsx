/**
 * NW OS — Production Work Queue (Factory Floor Visual Pipeline)
 * Stage-by-stage progression from Material Ready to Ready for Delivery
 */

import React from 'react';
import { useNW } from '../../context/NWContext';
import {
  Scissors,
  Cpu,
  Layers,
  Boxes,
  Sparkles,
  CheckCircle2,
  Package,
  Truck,
  ArrowRight,
  ShieldAlert,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { ProductionOrderStatus } from '../../types';

interface WorkQueueTabProps {
  onSelectOrder: (orderId: string) => void;
}

export const WorkQueueTab: React.FC<WorkQueueTabProps> = ({ onSelectOrder }) => {
  const { productionOrders, updateProductionOrderStatus } = useNW();

  const activePipelineStages: {
    stage: ProductionOrderStatus;
    label: string;
    icon: React.ReactNode;
    color: string;
  }[] = [
    { stage: 'Cutting', label: '1. Cutting', icon: <Scissors className="w-3.5 h-3.5" />, color: 'border-blue-300 bg-blue-50/40 text-blue-900' },
    { stage: 'CNC', label: '2. CNC Routing', icon: <Cpu className="w-3.5 h-3.5" />, color: 'border-cyan-300 bg-cyan-50/40 text-cyan-900' },
    { stage: 'Edge Banding', label: '3. Edge Banding', icon: <Layers className="w-3.5 h-3.5" />, color: 'border-teal-300 bg-teal-50/40 text-teal-900' },
    { stage: 'Assembly', label: '4. Assembly', icon: <Boxes className="w-3.5 h-3.5" />, color: 'border-indigo-300 bg-indigo-50/40 text-indigo-900' },
    { stage: 'Finishing', label: '5. Finishing', icon: <Sparkles className="w-3.5 h-3.5" />, color: 'border-violet-300 bg-violet-50/40 text-violet-900' },
    { stage: 'QC', label: '6. Factory QC', icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'border-purple-300 bg-purple-50/40 text-purple-900' },
    { stage: 'Packing', label: '7. Packing', icon: <Package className="w-3.5 h-3.5" />, color: 'border-orange-300 bg-orange-50/40 text-orange-900' },
    { stage: 'Ready for Delivery', label: '8. Dispatch Bay', icon: <Truck className="w-3.5 h-3.5" />, color: 'border-emerald-300 bg-emerald-50/40 text-emerald-900' },
  ];

  const handleQuickAdvance = (e: React.MouseEvent, orderId: string, currentStage: ProductionOrderStatus) => {
    e.stopPropagation();
    const stageSeq: ProductionOrderStatus[] = [
      'Cutting',
      'CNC',
      'Edge Banding',
      'Assembly',
      'Finishing',
      'QC',
      'Packing',
      'Ready for Delivery',
      'Completed',
    ];
    const idx = stageSeq.indexOf(currentStage);
    if (idx >= 0 && idx < stageSeq.length - 1) {
      updateProductionOrderStatus(orderId, stageSeq[idx + 1], 'Advanced via visual work queue');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          Live Shopfloor Work Queue ({productionOrders.filter((o) => activePipelineStages.some((s) => s.stage === o.current_stage)).length} In-Flight Orders)
        </h3>
        <span className="text-[11px] text-slate-500">
          Click any card to inspect drawing & joinery specs. Use arrow button to advance stage.
        </span>
      </div>

      {/* Horizontal Stage Columns */}
      <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-thin">
        {activePipelineStages.map(({ stage, label, icon, color }) => {
          const ordersInStage = productionOrders.filter((o) => o.current_stage === stage);

          return (
            <div
              key={stage}
              className="flex-shrink-0 w-72 bg-slate-100/70 border border-slate-200 rounded-xl p-3 flex flex-col max-h-[75vh]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                <div className="flex items-center space-x-1.5 font-bold text-xs text-slate-800">
                  {icon}
                  <span>{label}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white text-slate-700 border border-slate-200">
                  {ordersInStage.length}
                </span>
              </div>

              {/* Orders in this stage */}
              <div className="space-y-2.5 overflow-y-auto flex-1 pr-1">
                {ordersInStage.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg">
                    Stage empty
                  </div>
                ) : (
                  ordersInStage.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => onSelectOrder(ord.id)}
                      className={`p-3 bg-white border rounded-xl shadow-xs cursor-pointer hover:border-amber-400 transition-all hover:-translate-y-0.5 space-y-2 ${
                        ord.status === 'Blocked' ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900 text-xs">
                          {ord.order_number}
                        </span>
                        <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                          {ord.work_item_code}
                        </span>
                      </div>

                      <div className="text-[11px] font-semibold text-slate-800 line-clamp-1">
                        {ord.project_name.split('—')[0]}
                      </div>

                      <div className="text-[10px] text-slate-500 font-mono">
                        {ord.dimensions}
                      </div>

                      <div className="text-[10px] text-slate-600 line-clamp-1">
                        DWG: {ord.approved_nw_production_drawing_revision}
                      </div>

                      {/* Revision Warning if present */}
                      {ord.revision_alert && !ord.revision_alert.resolved && (
                        <div className="p-1.5 bg-rose-50 border border-rose-200 rounded text-[9px] text-rose-800 font-bold flex items-center space-x-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                          <span className="truncate">{ord.revision_alert.level}</span>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                        <span className="text-slate-400 truncate max-w-[120px]">{ord.contractor_name}</span>
                        {stage !== 'Ready for Delivery' && (
                          <button
                            onClick={(e) => handleQuickAdvance(e, ord.id, ord.current_stage)}
                            className="p-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded flex items-center space-x-1 font-bold transition-colors"
                            title="Advance to next stage"
                          >
                            <span>Next</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
