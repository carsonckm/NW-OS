/**
 * NW OS — AI Communication & Contractor Assistant Module
 *
 * Implements the complete First-Line Coordinator operating model:
 * 1. Multilingual Contractor Chat (English, Bahasa Malaysia, Chinese, Mixed Manglish/Rojak)
 * 2. WhatsApp-Ready Architecture & Message Pipeline
 * 3. Confidence Classification (CONFIRMED, PROBABLE, UNKNOWN)
 * 4. Controlled AI Action Engine (Auto QC task, progress logging, issue generation, variation capture)
 * 5. PM Communication & AI Inbox (Questions routed to human oversight with 1-click decisions)
 * 6. Owner Daily Briefing & Executive Exceptions
 * 7. Interactive Scenario Testing Suite (All 7 required scenarios with verification)
 * 8. Strict Security & Non-Bypassable Permission Guardrails
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import {
  ChatMessage,
  AIActionRecord,
  PMInboxItem,
  AIClassificationType,
  AIConfidenceLevel,
} from '../types';
import {
  Send,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Phone,
  Camera,
  Paperclip,
  Mic,
  MicOff,
  RefreshCw,
  Layers,
  Building2,
  Truck,
  HelpCircle,
  FileText,
  DollarSign,
  ChevronRight,
  Filter,
  Search,
  ArrowRight,
  Check,
  X,
  MessageSquare,
  Inbox,
  Award,
  Zap,
  Lock,
} from 'lucide-react';

export const AIAssistantView: React.FC = () => {
  const {
    currentUser,
    projects,
    selectedProjectId,
    setSelectedProjectId,
    workPackages,
    workItems,
    contractors,
    messages,
    aiActions,
    pmInbox,
    sendChatMessage,
    resolvePMInboxItem,
    runScenarioTest,
  } = useNW();

  // Active module tab
  const [activeTab, setActiveTab] = useState<'chat' | 'pm_inbox' | 'owner_briefing' | 'scenarios' | 'audit_log'>('chat');

  // Chat input state
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<'web' | 'whatsapp'>('whatsapp');
  const [targetItemCode, setTargetItemCode] = useState<string>('CAR-003');
  const [simulatedVoiceRecording, setSimulatedVoiceRecording] = useState(false);
  const [attachedPhoto, setAttachedPhoto] = useState<string | null>(null);

  // Scenario runner state
  const [activeScenarioRunning, setActiveScenarioRunning] = useState<number | null>(null);
  const [lastScenarioResult, setLastScenarioResult] = useState<any | null>(null);

  // PM Inbox decision modal / state
  const [replyingToInboxId, setReplyingToInboxId] = useState<string | null>(null);
  const [pmReplyText, setPmReplyText] = useState('');

  // Auto-scroll chat
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];
  const projectPackages = workPackages.filter((wp) => wp.project_id === currentProject?.id);
  const projectItems = workItems.filter((wi) => wi.project_id === currentProject?.id);

  // Send message handler
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isSending) return;

    setIsSending(true);
    setInputText('');
    setAttachedPhoto(null);

    try {
      await sendChatMessage({
        message_text: text.trim(),
        channel: selectedChannel,
        project_id: currentProject.id,
        work_item_code: targetItemCode,
        attachments: attachedPhoto
          ? [
              {
                id: 'att-' + Date.now(),
                type: 'image',
                url: attachedPhoto,
                name: 'Site-Inspection-Photo.jpg',
              },
            ]
          : undefined,
      });
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Run Scenario Test
  const handleRunScenario = async (scenarioId: number) => {
    setActiveScenarioRunning(scenarioId);
    try {
      const res = await runScenarioTest(scenarioId);
      setLastScenarioResult({ scenarioId, res });
    } catch (err) {
      console.error('Scenario test error:', err);
    } finally {
      setActiveScenarioRunning(null);
    }
  };

  // Voice recording simulation
  const toggleVoiceSimulation = () => {
    if (!simulatedVoiceRecording) {
      setSimulatedVoiceRecording(true);
      // Simulate speech to text after 2 seconds
      setTimeout(() => {
        setInputText('Counter 3 dah siap, esok morning boleh hantar ke Pavilion?');
        setSimulatedVoiceRecording(false);
      }, 2000);
    } else {
      setSimulatedVoiceRecording(false);
    }
  };

  // Photo simulation
  const triggerPhotoUpload = () => {
    setAttachedPhoto(
      'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&auto=format&fit=crop&q=80'
    );
  };

  const getConfidenceBadge = (confidence?: AIConfidenceLevel) => {
    switch (confidence) {
      case 'CONFIRMED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-300';
      case 'PROBABLE':
        return 'bg-amber-50 text-amber-800 border-amber-300';
      case 'UNKNOWN':
        return 'bg-slate-100 text-slate-700 border-slate-300';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Master Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-900 border border-amber-300 text-[10px] font-black uppercase tracking-widest flex items-center space-x-1">
              <Sparkles className="w-3 h-3 text-amber-700 fill-current" />
              <span>NW OS AI Communication Engine</span>
            </span>
            <span className="text-xs text-slate-500 font-mono">
              First-Line Coordinator (Zero Owner Fatigue)
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            AI Assistant & Contractor Communications Hub
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Understands multilingual trade messaging, executes routine updates automatically, and routes genuine exceptions to PMs & Owner.
          </p>
        </div>

        {/* Project Context Selector */}
        <div className="flex items-center space-x-2.5">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase font-bold text-slate-400">Target Project</div>
            <div className="text-xs font-bold text-slate-800 truncate max-w-[200px]">
              {currentProject?.project_name}
            </div>
          </div>
          <select
            value={currentProject?.id}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.project_name.split('—')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <MessageSquare className="w-4 h-4 text-amber-400" />
          <span>Contractor Chat Channel</span>
        </button>

        <button
          onClick={() => setActiveTab('pm_inbox')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
            activeTab === 'pm_inbox'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Inbox className="w-4 h-4 text-indigo-500" />
          <span>PM Communication Inbox</span>
          {pmInbox.filter((i) => i.status === 'pending').length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px] font-black">
              {pmInbox.filter((i) => i.status === 'pending').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('owner_briefing')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
            activeTab === 'owner_briefing'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Award className="w-4 h-4 text-amber-500" />
          <span>Owner Daily Briefing</span>
        </button>

        <button
          onClick={() => setActiveTab('scenarios')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
            activeTab === 'scenarios'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Zap className="w-4 h-4 text-emerald-500" />
          <span>Scenario Test Runner (1-7)</span>
        </button>

        <button
          onClick={() => setActiveTab('audit_log')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
            activeTab === 'audit_log'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-teal-500" />
          <span>AI Action & Audit Log ({aiActions.length})</span>
        </button>
      </div>

      {/* ---------------------------------------------------- */}
      {/* 1. CONTRACTOR CHAT CHANNEL TAB (Section 19, 20, 21) */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Chat Stream Area (3 cols) */}
          <div className="lg:col-span-3 bg-white border border-slate-200 rounded-3xl shadow-xs flex flex-col h-[700px] overflow-hidden">
            {/* Chat Top Banner */}
            <div className="bg-slate-900 text-white p-4 sm:px-6 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-400">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-white">NW OS Assistant</h2>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-[10px] text-emerald-300 font-mono">Live First-Line Coordinator</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Active on: <strong className="text-white">{currentProject?.project_name.split('—')[0]}</strong> • Trade: Carpentry & Joinery
                  </p>
                </div>
              </div>

              {/* Channel Selector */}
              <div className="flex items-center space-x-2 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
                <button
                  onClick={() => setSelectedChannel('whatsapp')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    selectedChannel === 'whatsapp'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  WhatsApp Channel
                </button>
                <button
                  onClick={() => setSelectedChannel('web')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    selectedChannel === 'web'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Web Terminal
                </button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 bg-slate-50/50">
              {messages.map((msg) => {
                const isAI = msg.is_ai_response;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isAI ? 'items-start' : 'items-end'}`}
                  >
                    <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 mb-1 px-1">
                      <span className="font-bold text-slate-600">{msg.sender_name}</span>
                      <span>•</span>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.channel === 'whatsapp' && (
                        <span className="text-emerald-600 font-bold bg-emerald-50 px-1 rounded border border-emerald-200">
                          WhatsApp
                        </span>
                      )}
                    </div>

                    <div
                      className={`max-w-[85%] sm:max-w-lg p-4 rounded-2xl shadow-2xs space-y-2 ${
                        isAI
                          ? 'bg-white border border-slate-200 text-slate-900 rounded-tl-xs'
                          : 'bg-slate-900 text-white rounded-tr-xs'
                      }`}
                    >
                      {/* Attached Photo */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="rounded-xl overflow-hidden border border-slate-200/40 mb-2">
                          <img
                            src={msg.attachments[0].url}
                            alt="Attachment"
                            className="w-full h-36 object-cover"
                          />
                        </div>
                      )}

                      <p className="text-xs leading-relaxed whitespace-pre-wrap">
                        {msg.message_text}
                      </p>

                      {/* AI Intelligence Metadata Badge */}
                      {isAI && (msg.ai_classification || msg.ai_confidence) && (
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1 text-[10px]">
                          <div className="flex items-center space-x-1.5">
                            {msg.ai_classification && (
                              <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                {msg.ai_classification}
                              </span>
                            )}
                            {msg.ai_confidence && (
                              <span
                                className={`px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider ${getConfidenceBadge(
                                  msg.ai_confidence
                                )}`}
                              >
                                {msg.ai_confidence}
                              </span>
                            )}
                          </div>

                          {msg.routed_to && msg.routed_to !== 'AI' && (
                            <span className="text-amber-700 font-bold flex items-center space-x-1">
                              <span>Routed to:</span>
                              <strong>{msg.routed_to}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isSending && (
                <div className="flex items-center space-x-2 text-xs text-slate-500 italic p-3 bg-white rounded-2xl border border-slate-200 w-fit">
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                  <span>NW OS AI analyzing approved project knowledge & rules...</span>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Quick Action Shortcuts for Contractors (Section 19) */}
            <div className="px-4 py-2 bg-slate-100/80 border-t border-slate-200 flex items-center space-x-2 overflow-x-auto scrollbar-none">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                Quick Shortcuts:
              </span>
              <button
                onClick={() => handleSendMessage('Counter 3 sudah siap.')}
                className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                ✅ Done (Sudah Siap)
              </button>
              <button
                onClick={() => handleSendMessage('Counter 1 80% done.')}
                className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-800 border border-blue-300 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                📸 Progress (80%)
              </button>
              <button
                onClick={() => handleSendMessage('Drawing say 2400 but site only 2300. Which one?')}
                className="px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                ⚠️ Problem (Dimension)
              </button>
              <button
                onClick={() => handleSendMessage('Boss, tomorrow can deliver?')}
                className="px-2.5 py-1 bg-white hover:bg-teal-50 text-teal-800 border border-teal-300 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                📦 Delivery (Boleh Hantar?)
              </button>
              <button
                onClick={() => handleSendMessage('柜台3做到哪里了？')}
                className="px-2.5 py-1 bg-white hover:bg-purple-50 text-purple-900 border border-purple-300 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                ❓ 柜台进度 (Chinese)
              </button>
            </div>

            {/* Bottom Input & Attachment Controls */}
            <div className="p-3.5 sm:p-4 bg-white border-t border-slate-200 space-y-2">
              {attachedPhoto && (
                <div className="flex items-center space-x-2 p-2 rounded-xl bg-slate-50 border border-slate-200 w-fit">
                  <img src={attachedPhoto} alt="Photo Preview" className="w-8 h-8 rounded-lg object-cover" />
                  <span className="text-xs text-slate-700 font-bold">Site-Photo-Attached.jpg</span>
                  <button
                    onClick={() => setAttachedPhoto(null)}
                    className="p-1 hover:bg-slate-200 rounded text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center space-x-2">
                {/* Voice Dictation Simulator */}
                <button
                  type="button"
                  onClick={toggleVoiceSimulation}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    simulatedVoiceRecording
                      ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                  }`}
                  title="Simulate Voice-to-Text in Malay/Chinese"
                >
                  <Mic className="w-4 h-4" />
                </button>

                {/* Photo Upload Simulator */}
                <button
                  type="button"
                  onClick={triggerPhotoUpload}
                  className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                  title="Attach Site Photo"
                >
                  <Camera className="w-4 h-4" />
                </button>

                {/* Text Input */}
                <input
                  type="text"
                  placeholder={
                    simulatedVoiceRecording
                      ? 'Listening... (Speak in English, Malay, or Chinese)'
                      : 'Type contractor message or question (e.g. "Counter 3 sudah siap")...'
                  }
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                />

                {/* Send Button */}
                <button
                  type="button"
                  disabled={!inputText.trim() && !attachedPhoto}
                  onClick={() => handleSendMessage()}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <span>Send</span>
                  <Send className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Active Work Items & Context Grounding */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                  Approved Knowledge Scope
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                The AI answers strictly from approved project drawings, production orders, and company standards.
              </p>
              <div className="space-y-1.5 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Drawing Ref</div>
                  <div className="font-bold text-slate-800">A-103 Rev 4 (Approved)</div>
                  <div className="text-[10px] text-slate-500">Retail Cashier & Displays</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Target Deliverable</div>
                  <div className="font-bold text-amber-800">CAR-003: Checkout Counter #03</div>
                  <div className="text-[10px] text-slate-500">2300mm (Scribed Plinth Solution)</div>
                </div>
              </div>
            </div>

            {/* Target Deliverable Selector */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                Contextual Work Item Focus
              </h3>
              <select
                value={targetItemCode}
                onChange={(e) => setTargetItemCode(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {projectItems.map((item) => (
                  <option key={item.id} value={item.item_code}>
                    {item.item_code} — {item.description.slice(0, 25)}...
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400">
                Simulates context when contractor references "this item" or "counter" without specifying codes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 2. PM COMMUNICATION INBOX TAB (Section 27) */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'pm_inbox' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>AI / COMMUNICATION INBOX (FOR PROJECT MANAGERS)</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({pmInbox.filter((i) => i.status === 'pending').length} Actions Required)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Items the AI coordinator classified as requiring human authorization or technical decisions.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {pmInbox.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No inbox actions currently pending.
              </div>
            ) : (
              pmInbox.map((item) => (
                <div
                  key={item.id}
                  className={`p-5 rounded-2xl border transition-all shadow-2xs space-y-3 ${
                    item.status === 'resolved'
                      ? 'bg-slate-50 border-slate-200 opacity-60'
                      : item.priority === 'Critical'
                      ? 'bg-rose-50/70 border-rose-300'
                      : item.priority === 'High'
                      ? 'bg-amber-50/60 border-amber-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          item.priority === 'Critical'
                            ? 'bg-rose-600 text-white'
                            : item.priority === 'High'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {item.priority}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-700">
                        {item.work_item_code || 'General'}
                      </span>
                      <span className="text-xs text-slate-400 font-semibold">• {item.category}</span>
                    </div>

                    <div className="text-xs text-slate-500">
                      Contractor: <strong className="text-slate-800">{item.contractor_name}</strong> •{' '}
                      <span className="font-mono">{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">Contractor Message:</div>
                    <blockquote className="p-3 bg-white rounded-xl border border-slate-200/80 text-xs font-bold text-slate-900 italic">
                      "{item.original_message}"
                    </blockquote>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white/80 rounded-xl border border-slate-200 space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-slate-400">AI Interpretation</div>
                      <div className="text-slate-800">{item.ai_interpretation}</div>
                    </div>
                    <div className="p-3 bg-white/80 rounded-xl border border-amber-300 space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-amber-800">Recommended PM Action</div>
                      <div className="text-slate-900 font-medium">{item.recommended_action}</div>
                    </div>
                  </div>

                  {item.status === 'pending' ? (
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setReplyingToInboxId(item.id);
                          setPmReplyText(
                            item.category === 'Drawing Question'
                              ? 'Proceed with 100mm scribing allowance on plinth per Standard #001.'
                              : item.category === 'Material Question'
                              ? '18mm rejected. Must adhere to 25mm marine plywood.'
                              : 'Confirmed. Mall clearance arranged for 10:00 AM.'
                          );
                        }}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                      >
                        Answer Contractor
                      </button>
                      <button
                        onClick={() => resolvePMInboxItem(item.id, 'approved')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                      >
                        Approve Action
                      </button>
                      <button
                        onClick={() => resolvePMInboxItem(item.id, 'escalated')}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                      >
                        Escalate to Owner
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-emerald-700 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Action resolved by Project Manager.</span>
                    </div>
                  )}

                  {/* Inline Reply Form */}
                  {replyingToInboxId === item.id && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-300 space-y-2 mt-2">
                      <div className="text-xs font-bold text-slate-700">Send Direct PM Answer to Stream:</div>
                      <textarea
                        value={pmReplyText}
                        onChange={(e) => setPmReplyText(e.target.value)}
                        rows={2}
                        className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => setReplyingToInboxId(null)}
                          className="px-2.5 py-1 text-xs text-slate-500 font-bold"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            resolvePMInboxItem(item.id, 'answered', pmReplyText);
                            setReplyingToInboxId(null);
                          }}
                          className="px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-lg"
                        >
                          Dispatch Response
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3. OWNER DAILY BRIEFING & EXCEPTIONS TAB (Section 28, 29) */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'owner_briefing' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-300 rounded">
                  Executive Exception Radar
                </span>
                <span className="text-xs font-mono text-slate-400">26 September 2026</span>
              </div>
              <h2 className="text-xl font-black text-slate-900 mt-1">
                Owner Daily Executive Briefing (Dato' Nicholas Wong)
              </h2>
              <p className="text-xs text-slate-500">
                Filters out routine site noise and presents ONLY critical decisions, contractual risks, and major variations.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Today: 5 Important Items */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-900 uppercase">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Today's Critical Focus (5 Items)</span>
              </div>
              <ul className="text-xs text-slate-700 space-y-1.5">
                <li className="flex items-start space-x-1.5">
                  <span className="text-rose-600 font-bold">•</span>
                  <span>Authorize VO-001 (Corian Solid Surface: RM 18,500)</span>
                </li>
                <li className="flex items-start space-x-1.5">
                  <span className="text-amber-600 font-bold">•</span>
                  <span>Confirm CAR-003 plinth trim exception for Pavilion mall fit</span>
                </li>
                <li className="flex items-start space-x-1.5">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>Review IPC-01 claim settlement from client (RM 185k received)</span>
                </li>
                <li className="flex items-start space-x-1.5">
                  <span className="text-slate-600 font-bold">•</span>
                  <span>Bangsar South acoustic veneer panel delivery dispatch</span>
                </li>
                <li className="flex items-start space-x-1.5">
                  <span className="text-slate-600 font-bold">•</span>
                  <span>Site supervisor gate pass check at Pavilion Loading Bay 3</span>
                </li>
              </ul>
            </div>

            {/* Risks: Projects Requiring Attention */}
            <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-rose-900 uppercase">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Active Project Risks (2 Sites)</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-rose-200">
                  <div className="font-bold text-slate-900">Project Aurora (Pavilion)</div>
                  <p className="text-rose-800 text-[11px] mt-0.5">
                    100mm wall discrepancy on Cashier. Resolved via plinth scribe; zero recutting cost.
                  </p>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-rose-200">
                  <div className="font-bold text-slate-900">Project Horizon (Bangsar South)</div>
                  <p className="text-rose-800 text-[11px] mt-0.5">
                    Acoustic wall board factory delay (5 days behind baseline program).
                  </p>
                </div>
              </div>
            </div>

            {/* Decisions: Decisions Required */}
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-900 uppercase">
                <Award className="w-4 h-4 text-amber-700" />
                <span>Executive Decision Required (1)</span>
              </div>
              <div className="bg-white p-3 rounded-xl border border-amber-300 space-y-1 text-xs">
                <div className="font-bold text-slate-900">VO-001 Client Upgrade Sign-off</div>
                <div className="font-mono text-xs text-amber-800 font-bold">Amount: RM 18,500</div>
                <p className="text-[11px] text-slate-600">
                  Corian solid surface countertop specified by client Michelle Tan. Margin +32%.
                </p>
                <div className="pt-2 flex justify-end">
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                    Awaiting Owner Signature
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 4. SCENARIO TEST RUNNER TAB (Section 32) */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'scenarios' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>INTERACTIVE DEMO & ACCEPTANCE SCENARIOS (1 TO 7)</span>
              </h2>
              <p className="text-xs text-slate-500">
                Click any scenario button to trigger the exact prompt text and observe automated classifications, safety checks, and routing.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                id: 1,
                title: 'Scenario 1: Completion in Malay',
                prompt: '"Counter 3 sudah siap."',
                expected: 'WorkItem CAR-003 status changed to Ready for QC (NOT QC Passed). Factory QC task created.',
                type: 'Completion Update',
              },
              {
                id: 2,
                title: 'Scenario 2: Delivery Slot Request',
                prompt: '"Counter 3 boleh hantar esok 10am?"',
                expected: 'Checks delivery schedule. If unscheduled, routes to PM; does NOT auto-schedule.',
                type: 'Delivery Request',
              },
              {
                id: 3,
                title: 'Scenario 3: Dimension Conflict',
                prompt: '"Drawing 2400 but site 2300."',
                expected: 'Creates Drawing Conflict Issue. AI does NOT choose a dimension.',
                type: 'Drawing Question',
              },
              {
                id: 4,
                title: 'Scenario 4: Material Substitution',
                prompt: '"Can use 18mm instead of 25mm?"',
                expected: 'Creates Material Change Request. AI does NOT authorize substitution.',
                type: 'Material Question',
              },
              {
                id: 5,
                title: 'Scenario 5: Scope Variation',
                prompt: '"Client ask add one more cabinet."',
                expected: 'Creates Potential Variation (Status: Identified). Routes to PM for pricing.',
                type: 'Variation Request',
              },
              {
                id: 6,
                title: 'Scenario 6: Production Query in Chinese',
                prompt: '"柜台3做到哪里？"',
                expected: 'Retrieves current Work Item status (Assembly) and responds politely in Chinese.',
                type: 'Production Question',
              },
              {
                id: 7,
                title: 'Scenario 7: Critical Safety Hazard',
                prompt: '"Boss emergency, electrical cable exposed."',
                expected: '⚠️ URGENT SAFETY ALERT: Critical issue created and immediate multi-tier escalation.',
                type: 'Urgent / Safety Issue',
              },
            ].map((sc) => (
              <div
                key={sc.id}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-all space-y-2.5 shadow-2xs flex flex-col justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">
                      {sc.id}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                      {sc.type}
                    </span>
                  </div>
                  <h3 className="text-xs font-bold text-slate-900">{sc.title}</h3>
                  <div className="p-2 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-800 font-bold">
                    {sc.prompt}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    <strong>Expected Behavior:</strong> {sc.expected}
                  </p>
                </div>

                <button
                  disabled={activeScenarioRunning === sc.id}
                  onClick={() => {
                    handleRunScenario(sc.id);
                    setActiveTab('chat');
                  }}
                  className="w-full mt-2 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                >
                  {activeScenarioRunning === sc.id ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Execute & View in Chat</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 5. AI ACTIONS & AUDIT LEDGER (Section 22, 31) */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'audit_log' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-tight flex items-center space-x-2">
                <span>AI ACTION & AUDIT LEDGER (ai_actions)</span>
                <span className="text-xs font-mono font-normal text-slate-400">
                  ({aiActions.length} Executed Records)
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Non-repudiation log tracking every AI interpretation, record modification, and human routing event.
              </p>
            </div>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Action ID</th>
                    <th className="px-4 py-3">Action Type</th>
                    <th className="px-4 py-3">Target Record</th>
                    <th className="px-4 py-3">Previous Value</th>
                    <th className="px-4 py-3">New Value</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Approval</th>
                    <th className="px-4 py-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-medium">
                  {aiActions.map((act) => (
                    <tr key={act.action_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">{act.action_id}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                          {act.action_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">{act.target_record}</td>
                      <td className="px-4 py-3 text-slate-400 font-mono">{act.previous_value || '—'}</td>
                      <td className="px-4 py-3 text-emerald-700 font-mono font-bold">{act.new_value || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${getConfidenceBadge(act.confidence)}`}>
                          {act.confidence}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            act.approval_status === 'auto_executed'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          }`}
                        >
                          {act.approval_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500">
                        {new Date(act.execution_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
