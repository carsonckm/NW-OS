import React, { useState } from 'react';
import {
  Layers,
  CheckCircle2,
  Play,
  ArrowRight,
  Building2,
  Calendar,
  Sparkles,
  Check,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { WorkflowTemplate } from '../../types';

export const WorkflowTemplatesTab: React.FC = () => {
  const { workflowTemplates, applyWorkflowTemplate, projects } = useNW();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(workflowTemplates[0]?.id || '');
  const [targetProjectId, setTargetProjectId] = useState<string>(projects[0]?.id || '');
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const selectedTemplate =
    workflowTemplates.find((t) => t.id === selectedTemplateId) || workflowTemplates[0];

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    const res = applyWorkflowTemplate(selectedTemplate.code, targetProjectId);
    const proj = projects.find((p) => p.id === targetProjectId);
    setApplyResult(
      `✓ Successfully initialized "${selectedTemplate.name}" for ${proj?.project_name}. Generated ${res.tasksCreated} sequential tasks in My Tasks inbox.`
    );
    setTimeout(() => setApplyResult(null), 6000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-blue-100 text-blue-900 rounded-lg">
              <Layers className="w-4 h-4 text-blue-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Standardized Workflow Templates (Section 41, 42 & 43)
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Turnkey checklists and automated sequential milestones for Supermarket Outlets, Retail Maintenance, and Corporate Fitouts.
          </p>
        </div>
      </div>

      {applyResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{applyResult}</span>
          </div>
          <button onClick={() => setApplyResult(null)} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
      )}

      {/* Grid: Templates list (4 cols) + Detail & Apply Station (8 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Template Selector Cards (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <div className="text-xs font-bold text-slate-500 px-1">Available Templates ({workflowTemplates.length})</div>

          {workflowTemplates.map((tpl) => {
            const isSelected = selectedTemplate?.id === tpl.id;
            return (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                  isSelected
                    ? 'bg-blue-50/60 border-blue-400 shadow-sm ring-1 ring-blue-400'
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-black text-blue-800 bg-blue-100 px-2 py-0.5 rounded">
                    {tpl.code}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold">{tpl.stages.length} Stages</span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">{tpl.name}</h4>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">{tpl.description}</p>
              </div>
            );
          })}
        </div>

        {/* Template Detail & Apply Station (8 cols) */}
        <div className="lg:col-span-8">
          {selectedTemplate ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                    {selectedTemplate.code}
                  </span>
                  <h3 className="text-base font-black text-slate-900 mt-2">{selectedTemplate.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{selectedTemplate.description}</p>
                </div>

                {/* Apply Template Form */}
                <form onSubmit={handleApply} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5 shrink-0 sm:w-72">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Apply To Active Project</span>
                  <select
                    value={targetProjectId}
                    onChange={(e) => setTargetProjectId(e.target.value)}
                    className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_number} • {p.project_name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="submit"
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5 text-amber-400" />
                    <span>Instantiate Workflow</span>
                  </button>
                </form>
              </div>

              {/* Sequential Stages List */}
              <div className="space-y-3">
                <span className="text-xs font-black uppercase text-slate-900 tracking-wider block">
                  Workflow Execution Stages ({selectedTemplate.stages.length})
                </span>

                <div className="space-y-3">
                  {selectedTemplate.stages.map((stage) => (
                    <div
                      key={stage.step_order}
                      className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-black flex items-center justify-center">
                            {stage.step_order}
                          </span>
                          <h4 className="text-xs font-bold text-slate-900">{stage.phase_name}</h4>
                        </div>
                        <span className="text-[10px] font-bold text-blue-900 bg-blue-100 px-2.5 py-0.5 rounded-full">
                          Default: {stage.default_role}
                        </span>
                      </div>

                      <div className="pl-8 space-y-1">
                        <div className="text-[11px] font-semibold text-slate-700">Action: {stage.action_type}</div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {stage.checklist.map((chk, i) => (
                            <span
                              key={i}
                              className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-md text-slate-600 flex items-center space-x-1"
                            >
                              <Check className="w-2.5 h-2.5 text-emerald-600" />
                              <span>{chk}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
              Select a template to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
