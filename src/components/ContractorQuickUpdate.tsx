/**
 * NW OS Contractor Mobile Quick Update Widget
 * Translates informal WhatsApp/voice messages in Chinese/Malay/English into structured NW OS workflow data.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import { Mic, Send, Sparkles, CheckCircle2, AlertTriangle, Truck } from 'lucide-react';

interface ContractorQuickUpdateProps {
  workItem: WorkItem;
  onOpenIssueModal: (itemId: string) => void;
  onOpenQCModal: (item: WorkItem) => void;
  onOpenDeliveryModal: (item: WorkItem) => void;
}

export const ContractorQuickUpdate: React.FC<ContractorQuickUpdateProps> = ({
  workItem,
  onOpenIssueModal,
  onOpenQCModal,
  onOpenDeliveryModal,
}) => {
  const { updateWorkItemStatus } = useNW();
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState<any>(null);

  const handleParse = async (textToParse?: string) => {
    const text = textToParse || inputText;
    if (!text.trim()) return;
    setIsProcessing(true);

    try {
      const res = await fetch('/api/ai/parse-contractor-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: text }),
      });

      if (res.ok) {
        const data = await res.json();
        setParseResult(data);
      }
    } catch (err) {
      console.warn('Contractor parse error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const applyParsedAction = () => {
    if (!parseResult) return;
    if (parseResult.action === 'Complete Work') {
      updateWorkItemStatus(workItem.id, 'Ready for QC', parseResult.notes);
    } else if (parseResult.action === 'Report Problem') {
      onOpenIssueModal(workItem.id);
    } else if (parseResult.action === 'Schedule Delivery') {
      onOpenDeliveryModal(workItem);
    }
    setParseResult(null);
    setInputText('');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 text-slate-800 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Quick Contractor Update (NLP Trilingual Parser)
          </h4>
        </div>
        <span className="text-[10px] text-slate-500 font-medium">BM / 中文 / English</span>
      </div>

      {/* Preset Quick Buttons representing realistic contractor messages */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => {
            setInputText('Counter 3 siap, boleh panggil PM inspect');
            handleParse('Counter 3 siap, boleh panggil PM inspect');
          }}
          className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
        >
          "Counter 3 siap (Ready for QC)"
        </button>

        <button
          type="button"
          onClick={() => {
            setInputText('柜台3做好了，明天早上10点安排3吨罗里送');
            handleParse('柜台3做好了，明天早上10点安排3吨罗里送');
          }}
          className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
        >
          "柜台3做好了，明天送 (Schedule Delivery)"
        </button>

        <button
          type="button"
          onClick={() => {
            setInputText('现场尺寸短了100mm，柜台放不进');
            handleParse('现场尺寸短了100mm，柜台放不进');
          }}
          className="text-[11px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium"
        >
          "现场尺寸短了100mm (Report Problem)"
        </button>
      </div>

      {/* Input Field */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type or paste WhatsApp message / update..."
          className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
          onKeyDown={(e) => e.key === 'Enter' && handleParse()}
        />
        <button
          onClick={() => handleParse()}
          disabled={isProcessing || !inputText.trim()}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
        >
          <span>{isProcessing ? 'Parsing...' : 'Analyze'}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Parsed Result Preview */}
      {parseResult && (
        <div className="mt-3 p-3.5 rounded-xl bg-amber-50/70 border border-amber-300 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">Detected Intent: {parseResult.action}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-amber-200 text-slate-700 font-mono font-medium">
              Target: {parseResult.item_code}
            </span>
          </div>
          <p className="text-xs text-slate-700">
            Suggested Status: <strong className="text-slate-900 font-bold">{parseResult.status_suggestion}</strong>
            {parseResult.delivery_timing && ` • Timing: ${parseResult.delivery_timing}`}
          </p>
          <div className="flex justify-end space-x-2 pt-1">
            <button
              onClick={() => setParseResult(null)}
              className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
            >
              Dismiss
            </button>
            <button
              onClick={applyParsedAction}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg shadow-2xs cursor-pointer"
            >
              Apply to NW OS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
