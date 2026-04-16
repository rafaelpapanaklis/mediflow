"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Zap, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
}

// Quick prompt templates for common doctor needs
const QUICK_PROMPTS = [
  { label:"📝 Nota SOAP",         text:"Ayúdame a redactar una nota SOAP para un paciente con: " },
  { label:"💊 Dosis medicamento",  text:"¿Cuál es la dosis estándar de " },
  { label:"🔬 Diagnóstico diferencial", text:"Paciente con los siguientes síntomas, dame diagnóstico diferencial: " },
  { label:"🧪 Estudios a pedir",   text:"¿Qué estudios de laboratorio y gabinete recomendarías para: " },
  { label:"⚠️ Interacción meds",   text:"¿Hay interacción entre " },
];

export default function AIAssistantPage() {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [usage,      setUsage]      = useState<UsageInfo | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [limitHit,   setLimitHit]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading || limitHit) return;

    const newMessages: Message[] = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          conversationHistory: messages, // send full history for context
        }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setLimitHit(true);
        setError(data.error);
        setMessages(prev => prev.slice(0, -1)); // remove last user message
        return;
      }

      if (!res.ok) throw new Error(data.error ?? "Error");

      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
      setUsage({ used: data.tokensUsed, limit: data.tokensLimit, remaining: data.tokensRemaining });

    } catch (err: any) {
      setError(err.message);
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  const usagePercent = usage ? Math.round(((usage.limit - usage.remaining) / usage.limit) * 100) : 0;

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Bot className="w-7 h-7 text-violet-600" /> Asistente IA Clínico
          </h1>
          <p className="text-base text-muted-foreground mt-0.5">Apoyo para diagnóstico, notas clínicas y medicamentos</p>
        </div>
        <button onClick={() => { setMessages([]); setError(null); setLimitHit(false); }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border hover:bg-muted text-sm font-semibold transition-colors">
          <RotateCcw className="w-4 h-4" /> Nueva consulta
        </button>
      </div>

      {/* Token usage bar */}
      {usage && (
        <div className="bg-card border border-border rounded-xl px-4 py-3 mb-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-violet-500" /> Uso mensual de IA
            </span>
            <span className="text-sm font-bold">{usage.remaining.toLocaleString()} tokens restantes</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${usagePercent > 80 ? "bg-rose-500" : usagePercent > 60 ? "bg-amber-500" : "bg-violet-500"}`}
              style={{ width: `${usagePercent}%` }} />
          </div>
          <div className="text-xs text-muted-foreground mt-1">{usagePercent}% usado este mes</div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex-shrink-0 text-sm text-amber-700 dark:text-amber-300">
        <strong>⚕️ Aviso médico:</strong> Este asistente es un apoyo informativo. Sus sugerencias no reemplazan el criterio clínico ni la exploración física del paciente.
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div className="flex-shrink-0 mb-4">
          <div className="text-sm font-bold text-muted-foreground mb-2">Consultas frecuentes:</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map(p => (
              <button key={p.label} onClick={() => setInput(p.text)}
                className="text-sm bg-card border border-border rounded-xl px-3 py-2 hover:border-violet-400 hover:text-violet-600 transition-colors font-semibold">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto bg-card border border-border rounded-2xl p-4 space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground py-8">
            <Bot className="w-16 h-16 mb-3 opacity-20" />
            <div className="text-lg font-semibold">¿En qué te puedo ayudar hoy?</div>
            <div className="text-sm mt-1 text-center max-w-xs">Pregúntame sobre diagnósticos, medicamentos, notas SOAP o cualquier consulta clínica.</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${msg.role === "user" ? "bg-brand-600 text-white" : "bg-violet-100 dark:bg-violet-900/40 text-violet-600"}`}>
              {msg.role === "user" ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-base ${msg.role === "user" ? "bg-brand-600 text-white rounded-tr-sm" : "bg-muted/40 text-foreground rounded-tl-sm"}`}
              style={{ whiteSpace:"pre-wrap", lineHeight:1.65 }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-muted/40 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay:"0ms" }} />
              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay:"150ms" }} />
              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay:"300ms" }} />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 flex gap-3">
        <textarea
          className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-600/20 resize-none"
          placeholder={limitHit ? "Límite mensual alcanzado" : "Escribe tu consulta clínica…"}
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading || limitHit}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
        />
        <button onClick={() => sendMessage()} disabled={!input.trim() || loading || limitHit}
          className="w-12 h-auto rounded-xl bg-violet-600 hover:bg-violet-700 text-white flex items-center justify-center transition-colors disabled:opacity-40">
          <Send className="w-5 h-5" />
        </button>
      </div>
      <div className="text-xs text-muted-foreground mt-2 text-center">Enter para enviar · Shift+Enter para nueva línea</div>
    </div>
  );
}
