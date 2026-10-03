/**
 * NW OS — WhatsApp-Ready Communication Gateway Module
 *
 * Implements the complete unified communication architecture:
 * 1. Unified Communication Layer (WhatsApp, NW OS, SMS, Email, Future channels)
 * 2. Secure Contact & WhatsApp Identity Mapping (Multi-phone support, strict verification)
 * 3. Inbound Message Pipeline (Phone ID -> Auth -> Trade scope -> Permission check -> AI Intent -> Decision Gate -> Action -> Outbound)
 * 4. Interactive WhatsApp Simulator (Testing & Dev environment clearly labeled SIMULATED WHATSAPP)
 * 5. Section 32 Security Tests Suite (Interactive test runner for all 8 mandatory security test cases)
 * 6. Live Inbound/Outbound Trace Inspector (6-stage execution telemetry)
 * 7. Human Approval Gate (AI Action Requests with Approve/Reject/Request Info)
 * 8. Outbound Message Queue (QUEUED, SENT, DELIVERED, retry & dispatch tracking)
 * 9. Communication Center Metrics & Human Override (Undo actions with audit logging)
 * 10. AI Knowledge Capture workflow (Save useful contractor methods to NW Production Knowledge)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import {
  GatewayChannel,
  CommunicationContact,
  GatewayMessage,
  MessageQueueItem,
  AIActionRequest,
  SecurityTestCase,
  SimulationTrace,
} from '../types';
import {
  MessageSquare,
  Send,
  Smartphone,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Check,
  X,
  RefreshCw,
  Search,
  Filter,
  Users,
  Settings,
  ListOrdered,
  Inbox,
  ArrowRight,
  Eye,
  Lock,
  Zap,
  Play,
  FileText,
  Camera,
  Paperclip,
  Mic,
  SlidersHorizontal,
  ChevronRight,
  RotateCcw,
  Sparkles,
  HelpCircle,
  TrendingUp,
  Building2,
  Layers,
  PhoneCall,
  CheckCheck,
  Check as SingleCheck,
  ExternalLink,
  BookOpen,
} from 'lucide-react';

export const WhatsAppGatewayView: React.FC = () => {
  const {
    currentUser,
    projects,
    selectedProjectId,
    gatewayContacts,
    gatewayMessages,
    conversationThreads,
    messageQueue,
    aiActionRequests,
    gatewaySettings,
    gatewayMetrics,
    securityTestCases,
    processSimulatedWhatsAppMessage,
    runSecurityTest,
    runAllSecurityTests,
    approveAIActionRequest,
    rejectAIActionRequest,
    requestMoreInfoForAction,
    retryQueueItem,
    cancelQueueItem,
    clearDeliveredQueue,
    verifyGatewayContact,
    updateGatewaySettings,
    undoAIAction,
    saveKnowledgeFromConversation,
    aiActions,
  } = useNW();

  // Navigation tab within the gateway
  const [activeTab, setActiveTab] = useState<
    'simulator' | 'dashboard' | 'approval_gate' | 'threads' | 'queue' | 'contacts' | 'settings'
  >('simulator');

  // Simulator State
  const [selectedContactId, setSelectedContactId] = useState<string>('cc-1'); // Default Ah Seng
  const [simulatorChannel, setSimulatorChannel] = useState<GatewayChannel>('WHATSAPP');
  const [simulatorInputText, setSimulatorInputText] = useState<string>('Counter 3 sudah siap.');
  const [isProcessingMessage, setIsProcessingMessage] = useState<boolean>(false);
  const [latestTrace, setLatestTrace] = useState<SimulationTrace | null>(null);
  const [isRunningAllTests, setIsRunningAllTests] = useState<boolean>(false);
  const [traceDrawerTab, setTraceDrawerTab] = useState<'trace' | 'tests'>('trace');
  const [activeVoiceSimulation, setActiveVoiceSimulation] = useState<boolean>(false);

  // Selected thread for conversation viewer
  const [selectedThreadId, setSelectedThreadId] = useState<string>(
    conversationThreads[0]?.thread_id || 'th-1'
  );
  const [threadReplyText, setThreadReplyText] = useState<string>('');

  // Knowledge Save Modal State
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState<boolean>(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState<string>('Plinth Scribing 100mm Field Tolerance');
  const [knowledgeCategory, setKnowledgeCategory] = useState<string>('Carpentry');
  const [knowledgeDesc, setKnowledgeDesc] = useState<string>(
    'Trim Module B bottom plinth filler by 100mm on-site to absorb mall column encroachment without scrapping factory-cut carcass.'
  );

  // Auto-scroll chat in simulator
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gatewayMessages]);

  const activeContact =
    gatewayContacts.find((c) => c.contact_id === selectedContactId) || gatewayContacts[0];

  // Filter messages for current selected simulator contact
  const simulatorMessages = gatewayMessages.filter(
    (m) =>
      m.sender_phone === activeContact?.phone_number ||
      m.recipient_phone === activeContact?.phone_number
  );

  // Handle Send Simulated Message
  const handleSendSimulatedMessage = async (customText?: string) => {
    const textToSend = customText || simulatorInputText;
    if (!textToSend.trim() || isProcessingMessage) return;

    setIsProcessingMessage(true);
    if (!customText) setSimulatorInputText('');

    try {
      const trace = await processSimulatedWhatsAppMessage({
        sender_phone: activeContact?.phone_number || '+60 12-398 5566',
        message_text: textToSend.trim(),
        channel: simulatorChannel,
        project_id: selectedProjectId,
      });
      setLatestTrace(trace);
      setTraceDrawerTab('trace');
    } catch (err) {
      console.error('Error processing gateway simulation:', err);
    } finally {
      setIsProcessingMessage(false);
    }
  };

  // Run all 8 security test cases sequentially
  const handleRunAllTests = async () => {
    setIsRunningAllTests(true);
    setTraceDrawerTab('tests');
    try {
      await runAllSecurityTests();
    } catch (err) {
      console.error('Error running security tests:', err);
    } finally {
      setIsRunningAllTests(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner: SIMULATED WHATSAPP (Required by Section 7, 33) */}
      <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start space-x-3">
          <div className="p-2.5 bg-amber-500 text-slate-950 rounded-xl shadow-xs shrink-0 mt-0.5">
            <Smartphone className="w-5 h-5 font-black" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-slate-900 text-sm tracking-wide">
                SIMULATED WHATSAPP & COMMUNICATION GATEWAY
              </span>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300">
                Testing & Dev Architecture
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Unified communication layer designed for future <strong>WhatsApp Business API</strong> connection.
              Connects directly to NW OS roles, permissions, drawings, and AI action gates without mockups or data silos.
            </p>
          </div>
        </div>

        {/* Channel Readiness Badges */}
        <div className="flex items-center flex-wrap gap-2 shrink-0">
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>WhatsApp Sandbox Ready</span>
          </span>
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-200">
            <span>NW OS In-App</span>
          </span>
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200">
            <span>SMS Queue</span>
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2 overflow-x-auto gap-2">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'simulator'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>WhatsApp Simulator</span>
          </button>

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'dashboard'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Communication Center</span>
          </button>

          <button
            onClick={() => setActiveTab('approval_gate')}
            className={`relative flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'approval_gate'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Human Approval Gate</span>
            {aiActionRequests.filter((r) => r.status === 'pending').length > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                {aiActionRequests.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('threads')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'threads'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Threads ({conversationThreads.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'queue'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>Outbound Queue ({messageQueue.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'contacts'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Contacts & Identity</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'settings'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. WHATSAPP SIMULATOR & SECURITY TEST SUITE TAB */}
      {/* ========================================================================= */}
      {activeTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: SIMULATED MOBILE WHATSAPP SCREEN (lg:col-span-5) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Sender Selection Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <PhoneCall className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Simulated Sender & Channel</span>
                </span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {gatewayContacts.length} Contacts Registered
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-slate-600 block">Select Sender Identity</label>
                <select
                  value={selectedContactId}
                  onChange={(e) => setSelectedContactId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {gatewayContacts.map((contact) => (
                    <option key={contact.contact_id} value={contact.contact_id}>
                      {contact.name} ({contact.role} — {contact.company_name}) [{contact.phone_number}]
                    </option>
                  ))}
                  <option value="unregistered">
                    🚨 Unregistered Number (+60 11-9999 0000) [Unknown Contact]
                  </option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 text-[11px]">Channel:</span>
                  <select
                    value={simulatorChannel}
                    onChange={(e) => setSimulatorChannel(e.target.value as GatewayChannel)}
                    className="bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-700"
                  >
                    <option value="WHATSAPP">WhatsApp (+60)</option>
                    <option value="NW_OS">NW OS In-App</option>
                    <option value="SMS">SMS Gateway</option>
                    <option value="EMAIL">Email</option>
                  </select>
                </div>

                <div className="flex items-center space-x-1">
                  <span className="text-[11px] text-slate-500">Trades:</span>
                  <span className="text-[11px] font-bold text-slate-800">
                    {activeContact?.assigned_trade_packages?.join(', ') || 'None'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile Phone Mockup Container */}
            <div className="bg-slate-900 rounded-3xl p-3 shadow-2xl border-4 border-slate-800 max-w-md mx-auto">
              {/* Phone Header */}
              <div className="bg-[#075E54] text-white rounded-t-2xl p-3 flex items-center justify-between shadow-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-emerald-800 flex items-center justify-center font-bold text-sm text-white border border-emerald-400">
                      {activeContact?.name?.charAt(0) || '?'}
                    </div>
                    {activeContact?.verified && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center border border-white">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-xs truncate max-w-[170px] leading-tight">
                      {selectedContactId === 'unregistered' ? 'Unknown Number' : activeContact?.name}
                    </div>
                    <div className="text-[10px] text-emerald-200 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{selectedContactId === 'unregistered' ? '+60 11-9999 0000' : activeContact?.phone_number}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/50">
                    NW OS GATEWAY
                  </span>
                </div>
              </div>

              {/* Chat Messages Body */}
              <div className="bg-[#EFEAE2] h-[380px] overflow-y-auto p-3 space-y-3 font-sans text-xs">
                {/* Security Notice Pill */}
                <div className="text-center my-1">
                  <span className="bg-amber-100/90 text-amber-900 text-[10px] font-semibold px-2.5 py-1 rounded-full border border-amber-200 shadow-2xs inline-block">
                    🔒 Messages processed by NW OS Gateway AI Gate
                  </span>
                </div>

                {simulatorMessages.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-xs">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300 opacity-60" />
                    <p>No messages in this test thread yet.</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Choose a quick prompt below or type your message.
                    </p>
                  </div>
                ) : (
                  simulatorMessages.slice(-6).map((msg) => {
                    const isInbound = msg.direction === 'INBOUND';
                    return (
                      <div
                        key={msg.message_id}
                        className={`flex flex-col ${isInbound ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs shadow-xs relative ${
                            isInbound
                              ? 'bg-[#E7FFDB] text-slate-900 rounded-br-2xs'
                              : 'bg-white text-slate-900 rounded-bl-2xs border border-slate-200'
                          }`}
                        >
                          {!isInbound && (
                            <div className="text-[10px] font-bold text-emerald-700 mb-0.5 flex items-center space-x-1">
                              <Sparkles className="w-3 h-3" />
                              <span>{msg.sender_name}</span>
                            </div>
                          )}
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.message_text}</p>
                          <div className="flex items-center justify-end space-x-1 mt-1 text-[9px] text-slate-400">
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {isInbound ? (
                              <CheckCheck className="w-3 h-3 text-blue-500" />
                            ) : (
                              <SingleCheck className="w-3 h-3 text-slate-400" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Quick Preset Test Prompts */}
              <div className="bg-slate-800 p-2 border-t border-slate-700">
                <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-1.5 px-1 flex items-center justify-between">
                  <span>Quick Test Prompts</span>
                  <span className="text-amber-400 text-[9px]">Click to populate</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                  {[
                    { label: 'Counter 3 finished (QC)', text: 'Counter 3 sudah siap.' },
                    { label: 'Deliver tomorrow? (Permit)', text: 'Boss, tomorrow can deliver?' },
                    { label: 'Change to 2300mm (Block)', text: 'Change Counter 3 to 2300mm.' },
                    { label: 'What is Contractor B doing?', text: 'What is Electrical Contractor B doing on site today?' },
                    { label: 'What is project profit?', text: 'What is the project profit and contract margin?' },
                    { label: 'Chinese Question', text: '柜台3目前做到哪个阶段了？几时需要送货？' },
                    { label: 'Ambiguous "That one finished"', text: 'That one finished.' },
                  ].map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setSimulatorInputText(p.text);
                      }}
                      className="bg-slate-700 hover:bg-emerald-700 text-slate-200 hover:text-white px-2 py-1 rounded-md text-[10px] transition-colors text-left"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Input Bar */}
              <div className="bg-slate-100 p-2.5 rounded-b-2xl flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setSimulatorInputText('Counter 3 finished with photo attached.')}
                  title="Simulate Photo Attachment"
                  className="p-1.5 text-slate-500 hover:text-emerald-600 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveVoiceSimulation(!activeVoiceSimulation);
                    if (!activeVoiceSimulation) {
                      setSimulatorInputText('Boss, Counter 3 ready for QC check.');
                    }
                  }}
                  title="Simulate WhatsApp Voice Message"
                  className={`p-1.5 rounded-lg transition-colors ${
                    activeVoiceSimulation
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'text-slate-500 hover:text-emerald-600 hover:bg-slate-200'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={simulatorInputText}
                  onChange={(e) => setSimulatorInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendSimulatedMessage();
                  }}
                  placeholder="Type contractor WhatsApp message..."
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={() => handleSendSimulatedMessage()}
                  disabled={isProcessingMessage || !simulatorInputText.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white p-2 rounded-xl shadow-xs transition-colors shrink-0"
                >
                  {isProcessingMessage ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: LIVE INSPECTION TRACE & SECURITY TESTS (lg:col-span-7) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Top Trace / Test Suite Toggle */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setTraceDrawerTab('trace')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-colors ${
                    traceDrawerTab === 'trace'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Live Execution Trace
                </button>
                <button
                  onClick={() => setTraceDrawerTab('tests')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-colors ${
                    traceDrawerTab === 'tests'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Section 32 Security Tests ({securityTestCases.filter((t) => t.status === 'PASSED').length}/8 Passed)
                </button>
              </div>

              {traceDrawerTab === 'tests' && (
                <button
                  onClick={handleRunAllTests}
                  disabled={isRunningAllTests}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isRunningAllTests ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>Run All 8 Tests</span>
                </button>
              )}
            </div>

            {/* TAB 1: LIVE EXECUTION TRACE (Section 8) */}
            {traceDrawerTab === 'trace' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      <span>Inbound & Outbound Pipeline Telemetry</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Real-time breakdown of identity, permissions, AI classification, action gates, and queue dispatch.
                    </p>
                  </div>
                  {latestTrace && (
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      ID: {latestTrace.inbound.message_id}
                    </span>
                  )}
                </div>

                {!latestTrace ? (
                  <div className="py-12 text-center text-slate-400 text-xs">
                    <Smartphone className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-medium text-slate-700">No simulated message run yet.</p>
                    <p className="text-slate-500 mt-1">
                      Type a message on the simulator or select a quick prompt on the left to see the full 6-stage trace.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Stage 1: INBOUND MESSAGE */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-blue-700">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          <span>1. INBOUND MESSAGE</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          Channel: {latestTrace.inbound.channel}
                        </span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs font-mono text-slate-800">
                        "{latestTrace.inbound.message_text}"
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                        <span>Sender: {latestTrace.inbound.sender_name}</span>
                        <span>Phone: {latestTrace.inbound.sender_phone}</span>
                      </div>
                    </div>

                    {/* Stage 2: SENDER VERIFICATION & PERMISSIONS */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-purple-700">
                          <span className="w-2 h-2 rounded-full bg-purple-500" />
                          <span>2. SENDER VERIFICATION & PERMISSION CHECK</span>
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            latestTrace.sender_verification.authorized
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {latestTrace.sender_verification.authorized ? 'AUTHORIZED' : 'ACCESS RESTRICTED'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mt-1">
                        {latestTrace.sender_verification.auth_reason}
                      </p>
                      <div className="flex items-center space-x-4 mt-2 text-[11px] text-slate-500">
                        <span>
                          Assigned Trades:{' '}
                          <strong>{latestTrace.sender_verification.assigned_trades.join(', ') || 'None'}</strong>
                        </span>
                        <span>
                          Registered:{' '}
                          <strong>{latestTrace.sender_verification.recognized ? 'Yes (Verified)' : 'No (Unknown)'}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Stage 3: AI INTERPRETATION & INTENT ENGINE */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-amber-700">
                          <span className="w-2 h-2 rounded-full bg-amber-500" />
                          <span>3. AI INTENT & WORK ITEM RESOLUTION</span>
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            latestTrace.ai_interpretation.confidence === 'HIGH'
                              ? 'bg-emerald-100 text-emerald-800'
                              : latestTrace.ai_interpretation.confidence === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          CONFIDENCE: {latestTrace.ai_interpretation.confidence}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div className="bg-white p-2 rounded border border-slate-200">
                          <span className="text-[10px] text-slate-400 block">Classified Intent:</span>
                          <span className="font-bold text-slate-800">{latestTrace.ai_interpretation.intent}</span>
                        </div>
                        <div className="bg-white p-2 rounded border border-slate-200">
                          <span className="text-[10px] text-slate-400 block">Resolved Work Item:</span>
                          <span className="font-bold text-slate-800">
                            {latestTrace.ai_interpretation.item_code || 'Unspecified / N/A'}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-2 italic">
                        "{latestTrace.ai_interpretation.reason}"
                      </p>
                    </div>

                    {/* Stage 4: AI DECISION GATE */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-indigo-700">
                          <span className="w-2 h-2 rounded-full bg-indigo-500" />
                          <span>4. AI ACTION GATE (Can AI Execute?)</span>
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            latestTrace.decision_gate.can_ai_execute
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          {latestTrace.decision_gate.can_ai_execute ? 'ACTION PERMITTED' : 'BLOCKED / HUMAN GATE'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-800 font-semibold">
                        Action: {latestTrace.decision_gate.action_name}
                      </div>
                      {latestTrace.decision_gate.blocked_reason && (
                        <p className="text-xs text-red-600 mt-1 bg-red-50 p-2 rounded border border-red-200">
                          {latestTrace.decision_gate.blocked_reason}
                        </p>
                      )}
                    </div>

                    {/* Stage 5: SYSTEM ACTION */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-teal-700">
                          <span className="w-2 h-2 rounded-full bg-teal-500" />
                          <span>5. DATABASE MUTATION / QC TASK CREATION</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {latestTrace.system_action?.executed ? 'DATABASE UPDATED' : 'NO MUTATION'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 mt-1">
                        {latestTrace.system_action?.description}
                      </p>
                      {latestTrace.system_action?.target_record && (
                        <span className="inline-block mt-2 text-[10px] font-bold bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200">
                          Record: {latestTrace.system_action.target_record}
                        </span>
                      )}
                    </div>

                    {/* Stage 6: OUTBOUND MESSAGE & QUEUE */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                        <span className="flex items-center space-x-1.5 text-emerald-700">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>6. OUTBOUND MESSAGE DISPATCHED TO QUEUE</span>
                        </span>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          QUEUED / SENT
                        </span>
                      </div>
                      <div className="bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-200 text-xs text-emerald-950 font-sans mt-2">
                        "{latestTrace.outbound_message?.message_text}"
                      </div>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                        <span>Recipient: {latestTrace.outbound_message?.recipient_phone}</span>
                        <span>Audit Log: RECORDED IN SYSTEM LEDGER</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SECTION 32 SECURITY TESTS SUITE */}
            {traceDrawerTab === 'tests' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Section 32 Security & Permission Verification Suite</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Mandatory automated test harness evaluating cross-contractor isolation, confidentiality, anti-guessing, and QC automation.
                    </p>
                  </div>
                  <button
                    onClick={handleRunAllTests}
                    disabled={isRunningAllTests}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center space-x-1"
                  >
                    {isRunningAllTests ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>Run All Tests</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {securityTestCases.map((test) => {
                    const isPassed = test.status === 'PASSED';
                    const isFailed = test.status === 'FAILED';
                    const isNotRun = test.status === 'NOT_RUN';

                    return (
                      <div key={test.id} className="py-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-slate-900">{test.title}</span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isPassed
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : isFailed
                                    ? 'bg-red-100 text-red-800 border border-red-300'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {test.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5">{test.description}</p>
                          </div>

                          <button
                            onClick={async () => {
                              await runSecurityTest(test.id);
                            }}
                            className="text-xs font-semibold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg shrink-0 transition-colors"
                          >
                            Run Test
                          </button>
                        </div>

                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1 font-mono">
                          <div className="text-slate-600">
                            <strong>Input:</strong> "{test.message_input}"
                          </div>
                          <div className="text-slate-600">
                            <strong>Expected:</strong> {test.expected_outcome}
                          </div>
                          {test.actual_outcome && (
                            <div className={`mt-1 font-semibold ${isPassed ? 'text-emerald-700' : 'text-red-700'}`}>
                              <strong>Actual:</strong> {test.actual_outcome}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. COMMUNICATION CENTER DASHBOARD TAB (Section 24 & 25) */}
      {/* ========================================================================= */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Top 6 KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                AI Handled
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-emerald-600">
                  {gatewayMetrics.ai_answered}
                </span>
                <span className="text-[11px] font-medium text-emerald-700">Auto-Resolved</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Direct from approved data</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Human Required
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-amber-600">
                  {gatewayMetrics.human_handoffs}
                </span>
                <span className="text-[11px] font-medium text-amber-700">PM / Site</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Pending leadership response</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Escalated
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-rose-600">
                  {gatewayMetrics.escalations}
                </span>
                <span className="text-[11px] font-medium text-rose-700">To Owner</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Protected by threshold</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Failed Messages
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-slate-900">
                  {gatewayMetrics.failed_responses}
                </span>
                <span className="text-[11px] font-medium text-slate-500">Errors</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Zero unhandled drops</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Unrecognized
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-blue-600">
                  {gatewayMetrics.unrecognized_contacts}
                </span>
                <span className="text-[11px] font-medium text-blue-700">Blocked</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Admin alerted to verify</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Active Threads
              </span>
              <div className="flex items-baseline space-x-1.5 mt-2">
                <span className="text-2xl font-black text-slate-900">
                  {conversationThreads.length}
                </span>
                <span className="text-[11px] font-medium text-slate-600">Channels</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">WhatsApp, In-App, SMS</p>
            </div>
          </div>

          {/* Operational Metrics Breakdown (Section 25) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span>Operational Response Telemetry</span>
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Total Gateway Messages:</span>
                    <span className="font-bold text-slate-900">{gatewayMetrics.total_messages}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">AI Actions Executed:</span>
                    <span className="font-bold text-emerald-600">{gatewayMetrics.ai_actions_executed}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Clarification Requests (Anti-Guessing):</span>
                    <span className="font-bold text-amber-600">{gatewayMetrics.clarification_requests}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Average Processing Latency:</span>
                    <span className="font-bold text-slate-900">{gatewayMetrics.avg_response_time_seconds}s</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Human Override Rate:</span>
                    <span className="font-bold text-slate-900">
                      {gatewayMetrics.human_override_count === 0 ? '0.0%' : '2.1%'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-600 block mb-1.5">
                    Confidence Distribution:
                  </span>
                  <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                    <div
                      style={{
                        width: `${Math.round(
                          (gatewayMetrics.high_confidence_count / Math.max(1, gatewayMetrics.total_messages)) *
                            100
                        )}%`,
                      }}
                      className="bg-emerald-500"
                      title="High Confidence"
                    />
                    <div
                      style={{
                        width: `${Math.round(
                          (gatewayMetrics.medium_confidence_count / Math.max(1, gatewayMetrics.total_messages)) *
                            100
                        )}%`,
                      }}
                      className="bg-amber-400"
                      title="Medium Confidence"
                    />
                    <div
                      style={{
                        width: `${Math.round(
                          (gatewayMetrics.low_confidence_count / Math.max(1, gatewayMetrics.total_messages)) *
                            100
                        )}%`,
                      }}
                      className="bg-rose-400"
                      title="Low Confidence"
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span className="flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>High ({gatewayMetrics.high_confidence_count})</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <span>Medium ({gatewayMetrics.medium_confidence_count})</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      <span>Low ({gatewayMetrics.low_confidence_count})</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Human Override & Knowledge Capture (Section 26 & 27) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <RotateCcw className="w-4 h-4 text-indigo-600" />
                <span>Human Override & Knowledge Capture</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">Recent AI Routine Actions:</span>
                    <span className="text-[10px] text-slate-500">Undoable</span>
                  </div>
                  {aiActions.slice(0, 2).map((action) => (
                    <div
                      key={action.action_id}
                      className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 block">{action.target_record}</span>
                        <span className="text-[10px] text-slate-500">{action.action_type} • {action.notes}</span>
                      </div>
                      <button
                        onClick={() => undoAIAction(action.action_id, 'Supervisor corrected stage')}
                        className="px-2 py-1 bg-slate-100 hover:bg-red-50 hover:text-red-700 text-slate-700 font-bold rounded text-[10px] transition-colors"
                      >
                        Undo Action
                      </button>
                    </div>
                  ))}
                </div>

                {/* Section 27: Save as NW Production Knowledge */}
                <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-950 flex items-center space-x-1">
                      <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                      <span>Knowledge Improvement</span>
                    </span>
                    <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      Section 27 Workflow
                    </span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    Did a PM provide a useful production solution in conversation? Promote it to the NW Production Knowledge base as a Draft.
                  </p>
                  <button
                    onClick={() => setKnowledgeModalOpen(true)}
                    className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                  >
                    + Save Conversation Solution to Knowledge Base
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. HUMAN APPROVAL GATE TAB (Section 12) */}
      {/* ========================================================================= */}
      {activeTab === 'approval_gate' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>AI Action Requests (Human Decision Gate)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Restricted technical changes, drawing modifications, and scope variations require explicit human authorization before execution.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
              {aiActionRequests.filter((r) => r.status === 'pending').length} Pending Requests
            </span>
          </div>

          <div className="space-y-4">
            {aiActionRequests.length === 0 ? (
              <p className="text-center py-10 text-xs text-slate-400">No action requests awaiting approval.</p>
            ) : (
              aiActionRequests.map((req) => (
                <div
                  key={req.id}
                  className={`border rounded-2xl p-4 space-y-3 transition-all ${
                    req.status === 'pending'
                      ? 'border-indigo-300 bg-indigo-50/30'
                      : req.status === 'approved'
                      ? 'border-emerald-300 bg-emerald-50/20'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-slate-900">{req.action_type}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                          {req.project_name} • {req.work_item_code}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            req.status === 'pending'
                              ? 'bg-blue-100 text-blue-800'
                              : req.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {req.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        From: <strong>{req.sender_name}</strong> ({req.sender_phone})
                      </p>
                    </div>

                    <span className="text-[11px] text-slate-400">
                      {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Original Message & Interpretation */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="bg-white p-3 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                        Original Message:
                      </span>
                      <p className="font-mono text-slate-900">"{req.original_message}"</p>
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                        AI Interpretation & Recommended Action:
                      </span>
                      <p className="text-slate-800">{req.recommended_action}</p>
                    </div>
                  </div>

                  {/* Supporting Drawings & Docs */}
                  {req.supporting_drawings && req.supporting_drawings.length > 0 && (
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-[11px] text-slate-500">Supporting Drawings:</span>
                      {req.supporting_drawings.map((dwg, i) => (
                        <span
                          key={i}
                          className="bg-slate-200 text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-300"
                        >
                          {dwg}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Decision Buttons */}
                  {req.status === 'pending' && (
                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
                      <button
                        onClick={() => requestMoreInfoForAction(req.id, 'Please confirm site photo')}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                      >
                        Request More Info
                      </button>
                      <button
                        onClick={() => rejectAIActionRequest(req.id, 'Rejected due to engineering tolerances')}
                        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 text-xs font-bold rounded-xl transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approveAIActionRequest(req.id, 'Approved by Project Manager')}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                      >
                        Approve Action
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. CONVERSATION THREADS INBOX (Section 13, 20, 21, 22) */}
      {/* ========================================================================= */}
      {activeTab === 'threads' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Threads List (lg:col-span-5) */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">
                Conversation Threads ({conversationThreads.length})
              </span>
              <span className="text-[11px] text-slate-500">Ownership & Escalation</span>
            </div>

            <div className="divide-y divide-slate-100">
              {conversationThreads.map((thread) => (
                <div
                  key={thread.thread_id}
                  onClick={() => setSelectedThreadId(thread.thread_id)}
                  className={`p-3 rounded-xl cursor-pointer transition-colors ${
                    selectedThreadId === thread.thread_id ? 'bg-amber-50/70 border border-amber-300' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">{thread.contact_name}</span>
                      <span className="text-[10px] text-slate-500">{thread.contact_phone} • {thread.channel}</span>
                    </div>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        thread.assigned_to === 'AI'
                          ? 'bg-emerald-100 text-emerald-800'
                          : thread.assigned_to === 'Owner'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      Owner: {thread.assigned_to}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-1">{thread.last_message_preview}</p>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400">
                    <span>Lang: {thread.language?.toUpperCase()}</span>
                    <span>{new Date(thread.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Thread Details & Reply (lg:col-span-7) */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  {conversationThreads.find((t) => t.thread_id === selectedThreadId)?.contact_name}
                </h3>
                <p className="text-xs text-slate-500">
                  Phone: {conversationThreads.find((t) => t.thread_id === selectedThreadId)?.contact_phone}
                </p>
              </div>
              <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded">
                Assigned: {conversationThreads.find((t) => t.thread_id === selectedThreadId)?.assigned_to}
              </span>
            </div>

            {/* Conversation Messages */}
            <div className="bg-slate-50 rounded-xl p-4 h-64 overflow-y-auto space-y-3">
              {gatewayMessages
                .filter(
                  (m) =>
                    m.sender_phone ===
                      conversationThreads.find((t) => t.thread_id === selectedThreadId)?.contact_phone ||
                    m.recipient_phone ===
                      conversationThreads.find((t) => t.thread_id === selectedThreadId)?.contact_phone
                )
                .map((msg) => (
                  <div
                    key={msg.message_id}
                    className={`flex flex-col ${msg.direction === 'INBOUND' ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl p-3 text-xs ${
                        msg.direction === 'INBOUND'
                          ? 'bg-white border border-slate-200 text-slate-900'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      <p className="font-semibold text-[10px] mb-0.5 opacity-80">{msg.sender_name}</p>
                      <p>{msg.message_text}</p>
                      <span className="text-[9px] block text-right mt-1 opacity-70">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
            </div>

            {/* Human PM Response Box (Section 20) */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-700 block">
                Human Leadership Response (Dispatches to WhatsApp Queue):
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={threadReplyText}
                  onChange={(e) => setThreadReplyText(e.target.value)}
                  placeholder="Type PM / Site Supervisor official instruction..."
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  onClick={() => {
                    if (!threadReplyText.trim()) return;
                    handleSendSimulatedMessage(`[PM Instruction]: ${threadReplyText.trim()}`);
                    setThreadReplyText('');
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Send Reply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. OUTBOUND MESSAGE QUEUE TAB (Section 18) */}
      {/* ========================================================================= */}
      {activeTab === 'queue' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <ListOrdered className="w-4 h-4 text-emerald-600" />
                <span>Outbound Message Queue (message_queue)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Buffers outgoing notifications and AI responses for reliable WhatsApp delivery with retry telemetry.
              </p>
            </div>
            <button
              onClick={clearDeliveredQueue}
              className="text-xs font-semibold px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            >
              Clear Delivered
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Queue ID</th>
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3">Recipient</th>
                  <th className="py-2.5 px-3">Content Preview</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Retries</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messageQueue.map((item) => (
                  <tr key={item.queue_id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-mono font-medium text-slate-700">{item.queue_id}</td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-[10px] bg-slate-100 text-slate-800 px-2 py-0.5 rounded">
                        {item.channel}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900">
                      {item.recipient_name}
                      <span className="block text-[10px] text-slate-400 font-mono">{item.recipient}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-700 max-w-xs truncate">{item.content}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.status === 'SENT' || item.status === 'DELIVERED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.status === 'QUEUED'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-mono">{item.retry_count}</td>
                    <td className="py-3 px-3 text-right space-x-1">
                      {item.status === 'FAILED' && (
                        <button
                          onClick={() => retryQueueItem(item.queue_id)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold"
                        >
                          Retry
                        </button>
                      )}
                      {item.status === 'QUEUED' && (
                        <button
                          onClick={() => cancelQueueItem(item.queue_id)}
                          className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-[10px] font-bold"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. CONTACTS & IDENTITY MAPPING TAB (Section 2 & 3) */}
      {/* ========================================================================= */}
      {activeTab === 'contacts' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Contact & Channel Mapping (communication_contacts)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Maps phone numbers to contractor and client accounts. Supports multiple numbers per contractor without assuming 1 phone = 1 user.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl">
              {gatewayContacts.length} Contacts Configured
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Contact Name</th>
                  <th className="py-2.5 px-3">Role & Company</th>
                  <th className="py-2.5 px-3">Phone Number</th>
                  <th className="py-2.5 px-3">Preferred Lang</th>
                  <th className="py-2.5 px-3">Assigned Trades</th>
                  <th className="py-2.5 px-3">Verified Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gatewayContacts.map((contact) => (
                  <tr key={contact.contact_id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-3 font-bold text-slate-900">{contact.name}</td>
                    <td className="py-3 px-3 text-slate-600">
                      <span className="font-medium text-slate-800">{contact.role}</span>
                      <span className="block text-[10px] text-slate-400">{contact.company_name}</span>
                    </td>
                    <td className="py-3 px-3 font-mono font-medium text-slate-800">{contact.phone_number}</td>
                    <td className="py-3 px-3">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                        {contact.preferred_language}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1">
                        {contact.assigned_trade_packages.map((tr, i) => (
                          <span
                            key={i}
                            className="bg-amber-100 text-amber-900 text-[10px] font-bold px-1.5 py-0.2 rounded"
                          >
                            {tr}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          contact.verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {contact.verified ? 'VERIFIED' : 'PENDING'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => verifyGatewayContact(contact.contact_id, !contact.verified)}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                      >
                        {contact.verified ? 'Revoke' : 'Verify'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. SETTINGS TAB (Section 28) */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
              <Settings className="w-4 h-4 text-slate-700" />
              <span>Gateway Configuration (Settings &rarr; Communication)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure communication channels, escalation timer thresholds, and AI action permissions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Channels & Timers */}
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="font-bold text-slate-800 block">Supported Channels</span>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.supported_channels.whatsapp}
                      onChange={(e) =>
                        updateGatewaySettings({
                          supported_channels: {
                            ...gatewaySettings.supported_channels,
                            whatsapp: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-medium text-slate-800">WhatsApp Business API Sandbox</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.supported_channels.nw_os}
                      onChange={(e) =>
                        updateGatewaySettings({
                          supported_channels: {
                            ...gatewaySettings.supported_channels,
                            nw_os: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-medium text-slate-800">NW OS In-App Chat</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.supported_channels.sms}
                      onChange={(e) =>
                        updateGatewaySettings({
                          supported_channels: {
                            ...gatewaySettings.supported_channels,
                            sms: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-medium text-slate-800">SMS Outbound Gateway</span>
                  </label>
                </div>
              </div>

              {/* Section 22: Escalation Timers */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="font-bold text-slate-800 block">Escalation Timers (Section 22)</span>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">Normal Priority Timeout:</span>
                    <span className="font-bold text-slate-900">{gatewaySettings.escalation_timers.normal_hours} Hours</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">High Priority Timeout:</span>
                    <span className="font-bold text-slate-900">{gatewaySettings.escalation_timers.high_hours} Hour</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">Critical Priority:</span>
                    <span className="font-bold text-red-600">Immediate Escalation to Owner</span>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Action Permissions */}
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="font-bold text-slate-800 block">AI Action Gate Controls (Section 11)</span>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.auto_qc_creation}
                      onChange={(e) => updateGatewaySettings({ auto_qc_creation: e.target.checked })}
                      className="rounded text-emerald-600"
                    />
                    <span className="text-slate-800">Auto-create QC Inspection task on completion update</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.auto_progress_update}
                      onChange={(e) => updateGatewaySettings({ auto_progress_update: e.target.checked })}
                      className="rounded text-emerald-600"
                    />
                    <span className="text-slate-800">Auto-update work item progress percentage</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.require_human_approval_for_variation}
                      onChange={(e) =>
                        updateGatewaySettings({ require_human_approval_for_variation: e.target.checked })
                      }
                      className="rounded text-emerald-600"
                    />
                    <span className="text-slate-800">Require PM approval before logging client variations</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={gatewaySettings.owner_protection_strict}
                      onChange={(e) =>
                        updateGatewaySettings({ owner_protection_strict: e.target.checked })
                      }
                      className="rounded text-emerald-600"
                    />
                    <span className="text-slate-800">Owner Protection (Dato' Nicholas receives only critical exceptions)</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Knowledge Modal (Section 27) */}
      {knowledgeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-amber-600" />
                <span>Save to NW Production Knowledge</span>
              </h3>
              <button
                onClick={() => setKnowledgeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Knowledge Title</label>
                <input
                  type="text"
                  value={knowledgeTitle}
                  onChange={(e) => setKnowledgeTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Trade Category</label>
                <select
                  value={knowledgeCategory}
                  onChange={(e) => setKnowledgeCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="Carpentry">Carpentry</option>
                  <option value="Joinery">Joinery</option>
                  <option value="Installation">Installation</option>
                  <option value="Practical Solutions">Practical Solutions</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Approved Method / Solution</label>
                <textarea
                  rows={3}
                  value={knowledgeDesc}
                  onChange={(e) => setKnowledgeDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs"
                />
              </div>

              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-900">
                <strong>Workflow Note:</strong> Saved as <em>Draft</em>. Requires NW Production Review approval before becoming reusable company knowledge.
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setKnowledgeModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  saveKnowledgeFromConversation({
                    title: knowledgeTitle,
                    category: knowledgeCategory,
                    description: knowledgeDesc,
                    reason: 'Derived from WhatsApp coordination',
                    scope: 'company',
                  });
                  setKnowledgeModalOpen(false);
                }}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
              >
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
