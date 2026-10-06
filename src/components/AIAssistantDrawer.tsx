/**
 * NW OS Intelligence Copilot Drawer
 * Role-aware AI Assistant querying approved project database with strict boundary enforcement.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Sparkles, X, Send, ShieldAlert, Bot, User, AlertCircle } from 'lucide-react';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { AssistantAnswerView, type AssistantResult } from './AssistantAnswerView';

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  /** Live mode: the server's structured answer (facts with confidence, recommendations). */
  result?: AssistantResult;
}

export const AIAssistantDrawer: React.FC<AIAssistantDrawerProps> = ({ isOpen, onClose }) => {
  const { currentUser, selectedProject, workItems, issues, variations, drawings, coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';

  const [inputQuestion, setInputQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'assistant',
      text: `Hello ${currentUser.name}. I am NW OS Intelligence. I can query approved shop drawings, work packages, delivery schedules, and site issues. I adhere to strict role permissions for ${currentUser.role}. How can I assist you?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  if (!isOpen) return null;

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = inputQuestion.trim();
    if (!q || loading) return;

    const userMsg: ChatMessage = {
      id: 'msg-' + Date.now(),
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuestion('');
    setLoading(true);

    if (live) {
      // Database mode: the server answers from what this user may see; nothing about the
      // user or their data is sent from the browser except the question and selected project.
      try {
        const result = await api.post<AssistantResult>('/assistant/ask', { question: q, project_id: selectedProject?.id });
        setMessages((prev) => [...prev, { id: 'ai-' + Date.now(), sender: 'assistant', text: result.answer, result, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      } catch (err) {
        setMessages((prev) => [...prev, { id: 'ai-' + Date.now(), sender: 'assistant', text: actionErrorOf(err).message, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      // Build role-safe context summary
      const projectContext = {
        project_name: selectedProject?.project_name,
        progress_percent: selectedProject?.progress_percent,
        target_completion: selectedProject?.end_date,
        user_role: currentUser.role,
        approved_drawings: drawings.map((d) => ({
          code: d.drawing_number,
          title: d.title,
          rev: d.revisions.find((r) => r.is_current)?.revision,
        })),
        active_work_items: workItems
          .filter((w) =>
            currentUser.role === 'Contractor' ? w.contractor_id === currentUser.contractor_id : true
          )
          .map((w) => ({
            code: w.item_code,
            desc: w.description,
            status: w.status,
            dimensions: w.dimensions,
            delivery: w.scheduled_delivery_date,
          })),
        critical_issues:
          currentUser.role === 'Client'
            ? [] // Never expose internal contractor disputes to client
            : issues.map((i) => ({ title: i.title, priority: i.priority, status: i.status })),
      };

      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          userRole: currentUser.role,
          userName: currentUser.name,
          projectContext,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const aiMsg: ChatMessage = {
          id: 'ai-' + Date.now(),
          sender: 'assistant',
          text: data.answer || 'No response generated.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, aiMsg]);
      }
    } catch (err) {
      console.warn('AI assistant fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white border-l border-slate-200 flex flex-col shadow-2xl text-slate-800">
          {/* Drawer Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-1.5">
                  <span>NW OS Intelligence</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-mono font-bold">
                    RBAC Enforced
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Active User: <strong className="text-slate-800">{currentUser.name}</strong> ({currentUser.role})
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Safety & Compliance Badge */}
          <div className="p-3 bg-amber-50/80 border-b border-amber-200 text-[11px] text-amber-900 flex items-start space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>Role Boundary Active:</strong> AI will never guess unapproved dimensions, will never expose contractor profit margins to clients, and will never override human approval.
            </div>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start space-x-2.5 ${
                  msg.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0 text-amber-600 text-xs shadow-2xs">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed shadow-xs ${
                    msg.sender === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.result ? <AssistantAnswerView result={msg.result} /> : <p>{msg.text}</p>}
                  <span
                    className={`block text-[10px] mt-1.5 ${
                      msg.sender === 'user' ? 'text-amber-950/70' : 'text-slate-400'
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>

                {msg.sender === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center space-x-2 text-xs text-amber-700 animate-pulse font-medium">
                <Bot className="w-4 h-4" />
                <span>Consulting approved NW OS database...</span>
              </div>
            )}
          </div>

          {/* Preset Prompts based on role */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-1.5">
            {currentUser.role === 'Owner / CEO' && (
              <>
                <button
                  onClick={() => {
                    setInputQuestion('What are my critical decisions and at-risk items today?');
                  }}
                  className="text-[10px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded-lg cursor-pointer transition-colors shadow-2xs"
                >
                  "What are my critical decisions today?"
                </button>
                <button
                  onClick={() => {
                    setInputQuestion('What is the status of the Cashier Counter CAR-003 dimension issue?');
                  }}
                  className="text-[10px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded-lg cursor-pointer transition-colors shadow-2xs"
                >
                  "CAR-003 dimension issue status?"
                </button>
              </>
            )}

            {currentUser.role === 'Contractor' && (
              <>
                <button
                  onClick={() => {
                    setInputQuestion('What are the approved dimensions for CAR-003 counter?');
                  }}
                  className="text-[10px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded-lg cursor-pointer transition-colors shadow-2xs"
                >
                  "Approved dimensions for CAR-003?"
                </button>
                <button
                  onClick={() => {
                    setInputQuestion('What items do I need to deliver this week?');
                  }}
                  className="text-[10px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded-lg cursor-pointer transition-colors shadow-2xs"
                >
                  "My deliveries this week?"
                </button>
              </>
            )}

            {currentUser.role === 'Client' && (
              <button
                onClick={() => {
                  setInputQuestion('When is our target completion date and what is current progress?');
                }}
                className="text-[10px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-2 py-1 rounded-lg cursor-pointer transition-colors shadow-2xs"
              >
                "Current progress and completion date?"
              </button>
            )}
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSend} className="p-4 border-t border-slate-200 bg-white flex gap-2">
            <input
              type="text"
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              placeholder={`Ask NW OS as ${currentUser.role}...`}
              className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
            />
            <button
              type="submit"
              disabled={loading || !inputQuestion.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
