import React, { useState, useEffect, useRef } from "react";
import {
  Home,
  LayoutGrid,
  Mic,
  FolderOpen,
  BookOpen,
  MessageSquare,
  Link2,
  BarChart3,
  Settings as SettingsIcon,
  Plus,
  ExternalLink,
  CheckCircle2,
  Flame,
  Send,
  Loader2,
  RotateCcw,
  Cloud,
  CloudOff,
} from "lucide-react";
import VibeForgeLogo from "../../buildanything/Frontend/src/components/VibeForgeLogo";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  Tooltip,
} from "recharts";
import { storage } from "./lib/storage";
import SplashScreen from "./components/SplashScreen";

/* ------------------------------------------------------------------ */
/*  PROMPTING LAYER — the "Interface Contract" from the planning doc.  */
/*  Keep in sync with logHeartbeat(string _category, string _summary,  */
/*  uint256 _xpReward) once Builder A ships the contract.              */
/* ------------------------------------------------------------------ */

const VIBE_PARSER_PROMPT = `You are the VibeForge Vibe-Parser. A builder pastes messy, unstructured notes about what they just did (voice-to-text, a half-finished thought, a copy-pasted error, whatever). Turn it into their build journal entry.

Respond with ONLY a raw JSON object, no markdown fences, no preamble, no explanation. Match this exact shape:

{
  "category": "Frontend" | "Backend" | "Contracts" | "Design" | "Research" | "Other",
  "summary": "one sentence, past tense, what they actually did",
  "openLoops": ["short phrase for each unresolved thread, 0-3 items"],
  "nextStep": "one concrete, immediately actionable next action",
  "xpValue": integer from 5 to 30 based on effort/impact implied by the note
}

Rules:
- category must be exactly one of the enum values.
- summary is one clear sentence, no hedging, written as if for a teammate's daily digest.
- openLoops are short noun phrases, not full sentences.
- nextStep is a single next action, not a list.
- xpValue: 5-10 for small/quick items, 11-20 for solid focused work, 21-30 for a shipped feature or hard unblock.
- If the note is too vague to parse confidently, still return your best-effort JSON — never ask a clarifying question, never return anything but the JSON object.`;

const COPILOT_SYSTEM_PROMPT = `You are Vibe Co-Pilot, the in-dashboard build assistant for VibeForge — a hackathon team shipping a decentralized builder-progress tracker on the Monad blockchain (Solidity contracts + a React/wagmi frontend + an LLM that parses messy notes into structured journal entries).

Answer like a sharp, fast teammate, not a customer support bot:
- Be concise and concrete. Prefer code over prose when the question is technical.
- When you show code, use fenced code blocks with a language tag.
- Default to Solidity/Foundry conventions for contract questions and React/wagmi/ethers.js conventions for frontend questions, unless told otherwise.
- If a suggestion trades off gas, security, or time-to-ship, name the tradeoff in one short line — don't lecture.
- No filler like "Great question!" — just answer.`;

/* ------------------------------------------------------------------ */
/*  NAV                                                                 */
/* ------------------------------------------------------------------ */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: Home },
  { key: "forge", label: "My Forge", icon: LayoutGrid },
  { key: "capture", label: "Capture", icon: Mic },
  { key: "projects", label: "Projects", icon: FolderOpen },
  { key: "learning", label: "Learning", icon: BookOpen },
  { key: "copilot", label: "Co-Pilot", icon: MessageSquare },
  { key: "onchain", label: "On-Chain", icon: Link2 },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

/* ------------------------------------------------------------------ */
/*  MOCK DATA (Builder A / on-chain / platform-sync territory — stays  */
/*  hardcoded until the real contract + BuildAnything API land)        */
/* ------------------------------------------------------------------ */

const PROJECTS = [
  { name: "Staking DApp", desc: "A decentralized staking platform built on Monad.", progress: 60 },
  { name: "NFT Reputation System", desc: "Soulbound reputation for builders on-chain.", progress: 30 },
  { name: "On-Chain Journal", desc: "Personal on-chain knowledge and progress tracker.", progress: 80 },
];

const ON_CHAIN_ACTIVITY = [
  { label: "Minted: Daily Progress #12", sub: "NFT", time: "2h ago" },
  { label: "Earned: Smart Contract Badge", sub: "SBT", time: "1d ago" },
  { label: "Minted: Project Milestone", sub: "Staking DApp — v0.1", time: "2d ago" },
];

const ANALYTICS_DATA = [
  { day: "M", xp: 40 },
  { day: "T", xp: 62 },
  { day: "W", xp: 51 },
  { day: "T", xp: 78 },
  { day: "F", xp: 65 },
  { day: "S", xp: 88 },
  { day: "S", xp: 74 },
];

const SKILLS = [
  { label: "Solidity", pct: 90 },
  { label: "Monad", pct: 75 },
  { label: "Smart Contracts", pct: 65 },
  { label: "Frontend", pct: 55 },
];

const KNOWLEDGE_NODES = [
  { label: "Lesson 12", sub: "Smart Contracts", angle: -90 },
  { label: "Idea", sub: "Reputation System", angle: -30 },
  { label: "Capture", sub: "Error Handling", angle: 30 },
  { label: "Snippet", sub: "useMonadClient", angle: 90 },
  { label: "Note", sub: "Gas Optimization", angle: 150 },
  { label: "Artifact", sub: "Staking Module", angle: 210 },
];

const MOCK_LESSONS = [
  { title: "Intro to Monad Parallel EVM", status: "Completed", badge: "Foundations" },
  { title: "Wallet Auth & Sessions", status: "Completed", badge: "Security" },
  { title: "Smart Contract Basics", status: "Completed", badge: "Contracts" },
  { title: "Gas Optimization Patterns", status: "In Progress", badge: "Contracts" },
  { title: "Building With Wagmi", status: "Not Started", badge: "Frontend" },
];

const DEFAULT_CAPTURES = [
  {
    id: 1,
    category: "Frontend",
    summary: "Fixed the dashboard rendering bugs on React.",
    openLoops: ["Connect MetaMask wallet state", "Animate the forge fire"],
    nextStep: "Create a wagmi hooks wrapper.",
    xpValue: 15,
    time: "2h ago",
  },
  {
    id: 2,
    category: "Contracts",
    summary: "Wrote the logHeartbeat function and unit tests.",
    openLoops: ["Gas profiling"],
    nextStep: "Deploy to Monad Devnet.",
    xpValue: 20,
    time: "5h ago",
  },
];

const DEFAULT_MESSAGES = [
  { role: "assistant", content: "Ask me anything about your code or architecture." },
];

const DEFAULT_XP = 2400;
const DEFAULT_NAME = "Toby";

const STORAGE_KEYS = {
  captures: "vibeforge:captures",
  totalXP: "vibeforge:total-xp",
  messages: "vibeforge:copilot-messages",
  profileName: "vibeforge:profile-name",
};

/* ------------------------------------------------------------------ */
/*  API + STORAGE HELPERS                                              */
/* ------------------------------------------------------------------ */

async function callClaude(system, userText) {
  // Calls our own Express server (server/index.js), which holds the real
  // OpenAI API key and forwards the request — the key never reaches
  // the browser. In dev, Vite proxies /api to http://localhost:3001.
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, message: userText }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ? JSON.stringify(data.error) : "Claude API request failed");
  }
  return data.text || "";
}

async function safeGet(key) {
  try {
    const res = await storage.get(key);
    return res ? res.value : null;
  } catch (e) {
    return null;
  }
}

async function safeSet(key, value) {
  try {
    const res = await storage.set(key, value);
    return !!res;
  } catch (e) {
    console.error("Storage set failed for", key, e);
    return false;
  }
}

async function safeDelete(key) {
  try {
    await storage.delete(key);
  } catch (e) {
    /* key may not exist — fine */
  }
}

/* ------------------------------------------------------------------ */
/*  SMALL UI PRIMITIVES                                                 */
/* ------------------------------------------------------------------ */

function Card({ children, className = "", style }) {
  return (
    <div className={`vf-card ${className}`} style={style}>
      {children}
    </div>
  );
}

function CategoryPill({ category }) {
  return <span className="vf-pill">{category}</span>;
}

function PageHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function StreakBadge() {
  return (
    <Card className="flex items-center gap-3" style={{ padding: "10px 16px" }}>
      <Flame size={18} color="#fb923c" />
      <div>
        <div className="vf-t10" style={{ color: "var(--text-3)" }}>
          Build Streak
        </div>
        <div className="text-lg font-semibold leading-none">12 days</div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: DASHBOARD (overview)                                          */
/* ------------------------------------------------------------------ */

function DashboardView({
  profileName,
  captures,
  totalXP,
  captureText,
  setCaptureText,
  isCapturing,
  captureError,
  onCapture,
  goTo,
}) {
  return (
    <>
      <PageHeader
        title={`Good morning, ${profileName}.`}
        subtitle="Here's your builder pulse for today."
        right={<StreakBadge />}
      />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold">Vibe Capture</h2>
            <span className="vf-pill">+{totalXP.toLocaleString()} XP</span>
          </div>
          <p className="vf-t11 mb-4" style={{ color: "var(--text-2)" }}>
            Type anything. Claude parses it into your build journal.
          </p>

          <div className="flex flex-col items-center py-3">
            <div className="vf-orb mb-4">
              <Mic size={26} color="var(--accent-light)" />
            </div>
            <textarea
              className="vf-input vf-scrollbar mb-2"
              rows={3}
              placeholder="e.g. finally fixed the gas issue in the staking loop..."
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
            />
            <button
              className="vf-btn-primary w-full justify-center"
              onClick={onCapture}
              disabled={isCapturing || !captureText.trim()}
            >
              {isCapturing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {isCapturing ? "Parsing…" : "Capture"}
            </button>
            {captureError && (
              <p className="vf-t11 mt-2" style={{ color: "#f87171" }}>
                Couldn't parse that one — try rephrasing.
              </p>
            )}
          </div>

          <div className="flex justify-between items-center mt-2 mb-2">
            <span className="text-xs font-medium">Recent Captures</span>
            <span
              className="vf-t11 vf-link"
              onClick={() => goTo("capture")}
              style={{ color: "var(--accent-light)" }}
            >
              View all
            </span>
          </div>
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto vf-scrollbar pr-1">
            {captures.slice(0, 4).map((c) => (
              <CaptureRow key={c.id} c={c} />
            ))}
          </div>
        </Card>

        <ForgeGraphCard onExplore={() => goTo("forge")} />
        <AnalyticsCard captures={captures} compact />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ProjectsCard onViewAll={() => goTo("projects")} />
        <CopilotPreviewCard onOpen={() => goTo("copilot")} />
        <OnChainCard onViewAll={() => goTo("onchain")} />
      </div>
    </>
  );
}

function CaptureRow({ c }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-1">
        <CategoryPill category={c.category} />
        <span className="vf-t10" style={{ color: "var(--text-3)" }}>
          {c.time}
        </span>
      </div>
      <div className="text-xs" style={{ color: "var(--text-1)" }}>
        {c.summary}
      </div>
      {c.nextStep && (
        <div className="vf-t11 mt-1" style={{ color: "var(--text-3)" }}>
          Next: {c.nextStep}
        </div>
      )}
      {c.openLoops && c.openLoops.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {c.openLoops.map((loop, i) => (
            <span
              key={i}
              className="vf-t10 rounded-full px-2 py-0.5"
              style={{ background: "var(--bg-base)", color: "var(--text-3)" }}
            >
              {loop}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: CAPTURE (full)                                                */
/* ------------------------------------------------------------------ */

function CaptureView({ captures, totalXP, captureText, setCaptureText, isCapturing, captureError, onCapture }) {
  return (
    <>
      <PageHeader
        title="Vibe Capture"
        subtitle="Dump anything. Claude turns it into a structured journal entry."
        right={<span className="vf-pill">+{totalXP.toLocaleString()} XP total</span>}
      />
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="flex flex-col items-center py-4">
            <div className="vf-orb mb-4">
              <Mic size={26} color="var(--accent-light)" />
            </div>
            <textarea
              className="vf-input vf-scrollbar mb-2"
              rows={6}
              placeholder="e.g. finally fixed the gas issue in the staking loop, still need to wire up the frontend event listener..."
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
            />
            <button
              className="vf-btn-primary w-full justify-center"
              onClick={onCapture}
              disabled={isCapturing || !captureText.trim()}
            >
              {isCapturing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {isCapturing ? "Parsing…" : "Capture"}
            </button>
            {captureError && (
              <p className="vf-t11 mt-2" style={{ color: "#f87171" }}>
                Couldn't parse that one — try rephrasing.
              </p>
            )}
          </div>
        </Card>
        <Card className="col-span-2">
          <div className="text-sm font-medium mb-3">
            Full History <span style={{ color: "var(--text-3)" }}>({captures.length})</span>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto vf-scrollbar pr-1" style={{ maxHeight: 520 }}>
            {captures.length === 0 ? (
              <p className="vf-t11" style={{ color: "var(--text-3)" }}>
                No captures yet — log your first one on the left.
              </p>
            ) : (
              captures.map((c) => <CaptureRow key={c.id} c={c} />)
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: MY FORGE                                                      */
/* ------------------------------------------------------------------ */

function ForgeGraphCard({ onExplore, full }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">My Forge</h2>
        {!full && (
          <button className="vf-btn-primary" style={{ padding: "6px 10px" }} onClick={onExplore}>
            Explore
          </button>
        )}
      </div>
      <div
        className="relative w-full mx-auto"
        style={{ aspectRatio: "1 / 1", maxWidth: full ? 360 : 280 }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
          {KNOWLEDGE_NODES.map((n, i) => {
            const rad = (n.angle * Math.PI) / 180;
            const x = 50 + 33 * Math.cos(rad);
            const y = 50 + 33 * Math.sin(rad);
            return <line key={i} x1="50" y1="50" x2={x} y2={y} stroke="var(--border)" strokeWidth="0.6" />;
          })}
        </svg>
        <div
          className="vf-node"
          style={{
            top: "50%",
            left: "50%",
            background: "var(--accent-dim)",
            borderColor: "var(--accent)",
            color: "var(--accent-light)",
            fontWeight: 600,
            padding: "10px 14px",
          }}
        >
          Staking DApp
        </div>
        {KNOWLEDGE_NODES.map((n, i) => {
          const rad = (n.angle * Math.PI) / 180;
          const x = 50 + 33 * Math.cos(rad);
          const y = 50 + 33 * Math.sin(rad);
          return (
            <div key={i} className="vf-node" style={{ top: `${y}%`, left: `${x}%` }}>
              <div style={{ fontWeight: 600 }}>{n.label}</div>
              <div style={{ color: "var(--text-3)" }}>{n.sub}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="vf-t11 font-medium mb-1" style={{ color: "var(--accent-light)" }}>
          AI Insight
        </div>
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          You keep returning to on-chain reputation systems. This could be your signature project.
        </p>
      </div>
    </Card>
  );
}

function ForgeView() {
  return (
    <>
      <PageHeader title="My Forge" subtitle="Your personal knowledge graph." />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <ForgeGraphCard full />
        </div>
        <Card>
          <div className="text-sm font-medium mb-3">Node Legend</div>
          <div className="flex flex-col gap-2">
            {KNOWLEDGE_NODES.map((n) => (
              <div key={n.label} className="flex items-center justify-between vf-t11">
                <span style={{ color: "var(--text-1)" }}>{n.label}</span>
                <span style={{ color: "var(--text-3)" }}>{n.sub}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: PROJECTS                                                      */
/* ------------------------------------------------------------------ */

function ProjectsCard({ onViewAll, full }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Projects</h2>
        {!full ? (
          <span className="vf-t11 vf-link" onClick={onViewAll} style={{ color: "var(--accent-light)" }}>
            View all
          </span>
        ) : (
          <button className="vf-btn-primary" style={{ padding: "6px 10px" }}>
            <Plus size={13} /> New
          </button>
        )}
      </div>
      <div className={full ? "grid grid-cols-3 gap-3" : "flex flex-col gap-2"}>
        {PROJECTS.map((p) => (
          <div
            key={p.name}
            className="rounded-lg p-3"
            style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
          >
            <div className="text-sm font-medium mb-1">{p.name}</div>
            <div className="vf-t11 mb-2" style={{ color: "var(--text-3)" }}>
              {p.desc}
            </div>
            <div className="rounded-full" style={{ height: 4, background: "var(--bg-base)" }}>
              <div
                className="rounded-full"
                style={{ height: 4, width: `${p.progress}%`, background: "var(--accent)" }}
              />
            </div>
            <div className="vf-t10 mt-1" style={{ color: "var(--text-3)" }}>
              {p.progress}%
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProjectsView() {
  return (
    <>
      <PageHeader title="Projects" subtitle="Your active builds." />
      <ProjectsCard full />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: LEARNING (BuildAnything sync — mocked per Phase 4)            */
/* ------------------------------------------------------------------ */

function LearningView() {
  const completed = MOCK_LESSONS.filter((l) => l.status === "Completed").length;
  return (
    <>
      <PageHeader
        title="Learning"
        subtitle="Synced from your Build Anything profile."
        right={
          <button className="vf-btn-primary">
            <Plus size={13} /> Import profile
          </button>
        }
      />
      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Build Anything progress</div>
            <div className="vf-t11" style={{ color: "var(--text-3)" }}>
              {completed} of {MOCK_LESSONS.length} lessons completed
            </div>
          </div>
          <div
            className="rounded-full"
            style={{ height: 6, width: 200, background: "var(--bg-surface-2)" }}
          >
            <div
              className="rounded-full"
              style={{
                height: 6,
                width: `${(completed / MOCK_LESSONS.length) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        </div>
      </Card>
      <Card>
        <div className="text-sm font-medium mb-3">Lessons & Badges</div>
        <div className="flex flex-col gap-2">
          {MOCK_LESSONS.map((l) => (
            <div
              key={l.title}
              className="flex items-center justify-between rounded-lg p-3"
              style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2">
                {l.status === "Completed" ? (
                  <CheckCircle2 size={15} color="var(--green)" />
                ) : (
                  <div
                    className="rounded-full"
                    style={{
                      width: 15,
                      height: 15,
                      border: "1.5px solid var(--text-3)",
                    }}
                  />
                )}
                <div>
                  <div className="text-xs" style={{ color: "var(--text-1)" }}>
                    {l.title}
                  </div>
                  <div className="vf-t10" style={{ color: "var(--text-3)" }}>
                    {l.status}
                  </div>
                </div>
              </div>
              <CategoryPill category={l.badge} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: CO-PILOT                                                      */
/* ------------------------------------------------------------------ */

function ChatPanel({ messages, input, setInput, isLoading, onSend, height }) {
  const chatEndRef = useRef(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="flex flex-col" style={{ height }}>
      <div className="flex-1 overflow-y-auto vf-scrollbar flex flex-col gap-2 pr-1">
        {messages.map((m, i) => (
          <div
            key={i}
            className="rounded-lg p-2.5 text-xs whitespace-pre-wrap"
            style={{
              background: m.role === "user" ? "var(--accent-dim)" : "var(--bg-surface-2)",
              border: "1px solid var(--border)",
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              color: m.role === "user" ? "var(--accent-light)" : "var(--text-1)",
            }}
          >
            {m.content}
          </div>
        ))}
        {isLoading && (
          <div className="vf-t11 flex items-center gap-1" style={{ color: "var(--text-3)" }}>
            <Loader2 size={11} className="animate-spin" /> thinking…
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="flex gap-2 mt-2">
        <input
          className="vf-input"
          placeholder="Ask anything about your code or architecture…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
        />
        <button
          className="vf-btn-primary"
          style={{ padding: "9px 11px" }}
          onClick={onSend}
          disabled={isLoading || !input.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </Card>
  );
}

function CopilotPreviewCard({ onOpen }) {
  return (
    <Card className="flex flex-col justify-between" style={{ height: 360 }}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Vibe Co-Pilot</h2>
          <span className="vf-t11 vf-link" onClick={onOpen} style={{ color: "var(--accent-light)" }}>
            Open
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Your build assistant, tuned to Solidity, Monad, and your project context.
        </p>
      </div>
      <button className="vf-btn-primary w-full justify-center" onClick={onOpen}>
        <MessageSquare size={14} /> Ask Co-Pilot
      </button>
    </Card>
  );
}

function CopilotView({ messages, input, setInput, isLoading, onSend }) {
  return (
    <>
      <PageHeader title="Vibe Co-Pilot" subtitle="Your build assistant." />
      <ChatPanel
        messages={messages}
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        onSend={onSend}
        height={560}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: ON-CHAIN                                                      */
/* ------------------------------------------------------------------ */

function OnChainCard({ onViewAll, full }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold">On-Chain</h2>
        {!full && (
          <span className="vf-t11 vf-link" onClick={onViewAll} style={{ color: "var(--accent-light)" }}>
            View all
          </span>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
        Builder Streak
      </p>
      <div className="flex items-center gap-3 mb-4">
        <Flame size={30} color="var(--accent-light)" />
        <div>
          <div className="text-2xl font-semibold leading-none">12 days</div>
          <div className="vf-t11 mt-1" style={{ color: "var(--text-3)" }}>
            Keep building to extend your streak.
          </div>
        </div>
      </div>
      <div className="text-xs font-medium mb-2">Recent On-Chain Activity</div>
      <div className="flex flex-col gap-2 mb-3">
        {ON_CHAIN_ACTIVITY.map((a) => (
          <div key={a.label} className="flex items-center justify-between vf-t11">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={13} color="var(--green)" />
              <div>
                <div style={{ color: "var(--text-1)" }}>{a.label}</div>
                <div style={{ color: "var(--text-3)" }}>{a.sub}</div>
              </div>
            </div>
            <span style={{ color: "var(--text-3)" }}>{a.time}</span>
          </div>
        ))}
      </div>
      <button
        className="vf-btn-primary w-full justify-center"
        style={{ background: "var(--bg-surface-2)", color: "var(--text-2)" }}
      >
        View all on Monad Explorer <ExternalLink size={12} />
      </button>
    </Card>
  );
}

function OnChainView() {
  return (
    <>
      <PageHeader
        title="On-Chain"
        subtitle="Mocked until Builder A's DeveloperHeartbeat contract is deployed — see the code comments for the hand-off point."
      />
      <div className="grid grid-cols-3 gap-4">
        <OnChainCard full />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: ANALYTICS                                                     */
/* ------------------------------------------------------------------ */

function AnalyticsCard({ captures, compact }) {
  const byCategory = captures.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
  const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const maxCount = categoryEntries.length ? categoryEntries[0][1] : 1;

  return (
    <Card>
      <h2 className="text-base font-semibold mb-1">Analytics</h2>
      <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
        Your builder stats
      </p>
      <div style={{ height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={ANALYTICS_DATA} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="vfXp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#1b1b23", border: "1px solid #26262f", borderRadius: 8, fontSize: 11 }}
            />
            <Area type="monotone" dataKey="xp" stroke="var(--accent-light)" strokeWidth={2} fill="url(#vfXp)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {!compact && categoryEntries.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium mb-2">Captures by category</div>
          <div className="flex flex-col gap-2">
            {categoryEntries.map(([cat, count]) => (
              <div key={cat}>
                <div className="flex justify-between vf-t11 mb-1">
                  <span style={{ color: "var(--text-2)" }}>{cat}</span>
                  <span style={{ color: "var(--text-3)" }}>{count}</span>
                </div>
                <div className="rounded-full" style={{ height: 4, background: "var(--bg-surface-2)" }}>
                  <div
                    className="rounded-full"
                    style={{ height: 4, width: `${(count / maxCount) * 100}%`, background: "var(--accent)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-3">
        {SKILLS.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between vf-t11 mb-1">
              <span style={{ color: "var(--text-2)" }}>{s.label}</span>
              <span style={{ color: "var(--text-3)" }}>{s.pct}%</span>
            </div>
            <div className="rounded-full" style={{ height: 4, background: "var(--bg-surface-2)" }}>
              <div className="rounded-full" style={{ height: 4, width: `${s.pct}%`, background: "var(--accent)" }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnalyticsView({ captures }) {
  return (
    <>
      <PageHeader title="Analytics" subtitle="Weekly XP trend, skill breakdown, and capture categories — the last one computed live from your real captures." />
      <div className="grid grid-cols-2 gap-4">
        <AnalyticsCard captures={captures} />
        <Card>
          <div className="text-sm font-medium mb-3">Focus Time / Captures / Code / XP</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Focus Time", value: "24h", delta: "+12%" },
              { label: "Captures", value: String(captures.length), delta: "+9%" },
              { label: "Code Written", value: "1.2k", delta: "+15%" },
              { label: "On-Chain XP", value: "2.4k", delta: "+20%" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg p-3"
                style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
              >
                <div className="vf-t10" style={{ color: "var(--text-3)" }}>
                  {s.label}
                </div>
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="vf-t10" style={{ color: "var(--green)" }}>
                  {s.delta}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: SETTINGS                                                      */
/* ------------------------------------------------------------------ */

function SettingsView({ profileName, setProfileName, onReset, syncStatus }) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Profile and local data." />
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="text-sm font-medium mb-3">Profile</div>
          <label className="vf-t11 block mb-1" style={{ color: "var(--text-3)" }}>
            Display name
          </label>
          <input
            className="vf-input mb-3"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <label className="vf-t11 block mb-1" style={{ color: "var(--text-3)" }}>
            Wallet address
          </label>
          <input className="vf-input" value="0x7F3…A9b2" disabled />
          <p className="vf-t10 mt-2" style={{ color: "var(--text-3)" }}>
            Placeholder until wagmi wallet connect is wired in.
          </p>
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3">Local data</div>
          <div className="flex items-center gap-2 mb-3 vf-t11" style={{ color: "var(--text-3)" }}>
            {syncStatus === "saved" && <Cloud size={14} color="var(--green)" />}
            {syncStatus === "saving" && <Loader2 size={14} className="animate-spin" />}
            {syncStatus === "error" && <CloudOff size={14} color="#f87171" />}
            {syncStatus === "saved" && "All changes saved"}
            {syncStatus === "saving" && "Saving…"}
            {syncStatus === "error" && "Couldn't save — will retry"}
            {syncStatus === "idle" && "No changes yet"}
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
            Captures, XP, and your Co-Pilot chat are saved to your account and persist across
            sessions. This data is personal to you.
          </p>
          <button
            className="vf-btn-primary"
            style={{ background: "var(--bg-surface-2)", color: "#f87171" }}
            onClick={onReset}
          >
            <RotateCcw size={13} /> Reset local data
          </button>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                      */
/* ------------------------------------------------------------------ */

export default function VibeForgeDashboard() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [isLoaded, setIsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");

  const [profileName, setProfileName] = useState(DEFAULT_NAME);
  const [captureText, setCaptureText] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [captures, setCaptures] = useState(DEFAULT_CAPTURES);
  const [totalXP, setTotalXP] = useState(DEFAULT_XP);
  const [captureError, setCaptureError] = useState(false);

  const [messages, setMessages] = useState(DEFAULT_MESSAGES);
  const [copilotInput, setCopilotInput] = useState("");
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);

  /* ---- load persisted data once on mount ---- */
  useEffect(() => {
    const startedAt = Date.now();
    (async () => {
      const [capturesRaw, xpRaw, messagesRaw, nameRaw] = await Promise.all([
        safeGet(STORAGE_KEYS.captures),
        safeGet(STORAGE_KEYS.totalXP),
        safeGet(STORAGE_KEYS.messages),
        safeGet(STORAGE_KEYS.profileName),
      ]);
      if (capturesRaw) {
        try {
          setCaptures(JSON.parse(capturesRaw));
        } catch (e) {}
      }
      if (xpRaw) {
        try {
          setTotalXP(JSON.parse(xpRaw));
        } catch (e) {}
      }
      if (messagesRaw) {
        try {
          setMessages(JSON.parse(messagesRaw));
        } catch (e) {}
      }
      if (nameRaw) setProfileName(nameRaw);

      const elapsed = Date.now() - startedAt;
      const MIN_SPLASH_MS = 3000;
      if (elapsed < MIN_SPLASH_MS) {
        await new Promise((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
      }
      setIsLoaded(true);
    })();
  }, []);

  /* ---- persist on change, after initial load ---- */
  useEffect(() => {
    if (!isLoaded) return;
    setSyncStatus("saving");
    Promise.all([
      safeSet(STORAGE_KEYS.captures, JSON.stringify(captures)),
      safeSet(STORAGE_KEYS.totalXP, JSON.stringify(totalXP)),
      safeSet(STORAGE_KEYS.messages, JSON.stringify(messages)),
      safeSet(STORAGE_KEYS.profileName, profileName),
    ]).then((results) => {
      setSyncStatus(results.every(Boolean) ? "saved" : "error");
    });
  }, [captures, totalXP, messages, profileName, isLoaded]);

  async function handleCapture() {
    if (!captureText.trim() || isCapturing) return;
    setIsCapturing(true);
    setCaptureError(false);
    try {
      const raw = await callClaude(VIBE_PARSER_PROMPT, captureText);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const entry = {
        id: Date.now(),
        category: parsed.category || "Other",
        summary: parsed.summary || captureText.slice(0, 100),
        openLoops: Array.isArray(parsed.openLoops) ? parsed.openLoops : [],
        nextStep: parsed.nextStep || "",
        xpValue: Number.isFinite(parsed.xpValue) ? parsed.xpValue : 10,
        time: "Just now",
      };
      setCaptures((prev) => [entry, ...prev]);
      setTotalXP((prev) => prev + entry.xpValue);
      setCaptureText("");
    } catch (err) {
      console.error("Vibe-Parser error:", err);
      setCaptureError(true);
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleCopilotSend() {
    if (!copilotInput.trim() || isCopilotLoading) return;
    const userMsg = { role: "user", content: copilotInput };
    setMessages((prev) => [...prev, userMsg]);
    setCopilotInput("");
    setIsCopilotLoading(true);
    try {
      const reply = await callClaude(COPILOT_SYSTEM_PROMPT, copilotInput);
      setMessages((prev) => [...prev, { role: "assistant", content: reply || "…" }]);
    } catch (err) {
      console.error("Co-Pilot error:", err);
      setMessages((prev) => [...prev, { role: "assistant", content: "Couldn't reach the model just now — try again." }]);
    } finally {
      setIsCopilotLoading(false);
    }
  }

  async function handleReset() {
    await Promise.all([
      safeDelete(STORAGE_KEYS.captures),
      safeDelete(STORAGE_KEYS.totalXP),
      safeDelete(STORAGE_KEYS.messages),
      safeDelete(STORAGE_KEYS.profileName),
    ]);
    setCaptures(DEFAULT_CAPTURES);
    setTotalXP(DEFAULT_XP);
    setMessages(DEFAULT_MESSAGES);
    setProfileName(DEFAULT_NAME);
  }

  function renderPage() {
    switch (activeNav) {
      case "dashboard":
        return (
          <DashboardView
            profileName={profileName}
            captures={captures}
            totalXP={totalXP}
            captureText={captureText}
            setCaptureText={setCaptureText}
            isCapturing={isCapturing}
            captureError={captureError}
            onCapture={handleCapture}
            goTo={setActiveNav}
          />
        );
      case "forge":
        return <ForgeView />;
      case "capture":
        return (
          <CaptureView
            captures={captures}
            totalXP={totalXP}
            captureText={captureText}
            setCaptureText={setCaptureText}
            isCapturing={isCapturing}
            captureError={captureError}
            onCapture={handleCapture}
          />
        );
      case "projects":
        return <ProjectsView />;
      case "learning":
        return <LearningView />;
      case "copilot":
        return (
          <CopilotView
            messages={messages}
            input={copilotInput}
            setInput={setCopilotInput}
            isLoading={isCopilotLoading}
            onSend={handleCopilotSend}
          />
        );
      case "onchain":
        return <OnChainView />;
      case "analytics":
        return <AnalyticsView captures={captures} />;
      case "settings":
        return (
          <SettingsView
            profileName={profileName}
            setProfileName={setProfileName}
            onReset={handleReset}
            syncStatus={syncStatus}
          />
        );
      default:
        return null;
    }
  }

  if (!isLoaded) {
    return <SplashScreen />;
  }

  return (
    <div className="vf-root">
      <style>{`
        .vf-root {
          --bg-base: #08080c;
          --bg-surface: #131318;
          --bg-surface-2: #1b1b23;
          --border: #26262f;
          --accent: #7c5cfc;
          --accent-light: #a78bfa;
          --accent-dim: rgba(124, 92, 252, 0.15);
          --green: #4ade80;
          --text-1: #f5f5f7;
          --text-2: #9ca3af;
          --text-3: #6b7280;
          background: var(--bg-base);
          color: var(--text-1);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          min-height: 100%;
          display: flex;
        }
        .vf-sidebar {
          width: 220px;
          flex-shrink: 0;
          border-right: 1px solid var(--border);
          padding: 20px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .vf-nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 10px;
          color: var(--text-2);
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .vf-nav-item:hover { background: var(--bg-surface-2); color: var(--text-1); }
        .vf-nav-item.active { background: var(--accent-dim); color: var(--accent-light); }
        .vf-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 18px;
        }
        .vf-pill {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--accent-dim);
          color: var(--accent-light);
        }
        .vf-btn-primary {
          background: linear-gradient(135deg, var(--accent), #6142e0);
          color: white;
          font-size: 13px;
          font-weight: 600;
          border: none;
          border-radius: 10px;
          padding: 9px 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: opacity 0.15s;
        }
        .vf-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .vf-btn-primary:not(:disabled):hover { opacity: 0.9; }
        .vf-input {
          background: var(--bg-surface-2);
          border: 1px solid var(--border);
          border-radius: 10px;
          color: var(--text-1);
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
          width: 100%;
        }
        .vf-input:focus { border-color: var(--accent); }
        .vf-input:disabled { opacity: 0.6; }
        .vf-orb {
          width: 118px;
          height: 118px;
          border-radius: 50%;
          border: 1.5px solid var(--accent);
          box-shadow: 0 0 32px var(--accent-dim), inset 0 0 24px var(--accent-dim);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: vf-pulse 2.8s ease-in-out infinite;
        }
        @keyframes vf-pulse {
          0%, 100% { box-shadow: 0 0 24px var(--accent-dim), inset 0 0 18px var(--accent-dim); }
          50% { box-shadow: 0 0 44px var(--accent-dim), inset 0 0 30px var(--accent-dim); }
        }
        .vf-node {
          position: absolute;
          transform: translate(-50%, -50%);
          background: var(--bg-surface-2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 6px 10px;
          font-size: 10.5px;
          white-space: nowrap;
        }
        .vf-link { cursor: pointer; }
        .vf-link:hover { text-decoration: underline; }
        .vf-scrollbar::-webkit-scrollbar { width: 5px; }
        .vf-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .vf-t10 { font-size: 10px; }
        .vf-t11 { font-size: 11px; }
      `}</style>

      {/* SIDEBAR */}
      <aside className="vf-sidebar">
        <div className="flex items-center gap-2 px-2 pb-5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 30, height: 30, background: "var(--accent-dim)" }}
          >
            <VibeForgeLogo size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">VibeForge</div>
            <div className="vf-t10 leading-none mt-1" style={{ color: "var(--text-3)" }}>
              Builder OS
            </div>
          </div>
        </div>

        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            className={`vf-nav-item ${activeNav === item.key ? "active" : ""}`}
            onClick={() => setActiveNav(item.key)}
          >
            <item.icon size={16} />
            {item.label}
          </div>
        ))}

        <div className="mt-auto pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div
            className={`vf-nav-item ${activeNav === "settings" ? "active" : ""}`}
            onClick={() => setActiveNav("settings")}
          >
            <SettingsIcon size={16} />
            Settings
          </div>
          <div className="flex items-center gap-2 px-2 pt-3">
            <div className="rounded-full" style={{ width: 28, height: 28, background: "var(--accent)" }} />
            <div className="flex-1">
              <div className="text-xs font-medium">{profileName}</div>
              <div className="vf-t10" style={{ color: "var(--text-3)" }}>
                0x7F3…A9b2
              </div>
            </div>
            {syncStatus === "saved" && <Cloud size={12} color="var(--green)" />}
            {syncStatus === "saving" && <Loader2 size={12} className="animate-spin" color="var(--text-3)" />}
            {syncStatus === "error" && <CloudOff size={12} color="#f87171" />}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-6 overflow-y-auto vf-scrollbar" style={{ maxHeight: "100vh" }}>
        {renderPage()}
      </main>
    </div>
  );
}