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
  Square,
  X,
  ImagePlus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useAccount, useConnect, useDisconnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { CONTRACT_ADDRESS, HEARTBEAT_ABI } from "./lib/contract";
import { useHeartbeats } from "./hooks/useHeartbeats";
import { useSoul } from "./hooks/useSoul";
import { SOUL_CONTRACT_ADDRESS, SOUL_ABI } from "./lib/soulContract";
import { supabase, loadCloudData, saveCloudData } from "./lib/supabase";
import VibeForgeLogo from "./components/VibeForgeLogo";
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
  "xpValue": integer from 5 to 30 based on effort/impact implied by the note,
  "matchedStep": "the exact text of a plan step (from the 'Current plan' list below the note, if present) that this capture completes, or null if none apply or no plan is listed",
  "lesson": "a short, specific thing the builder learned or figured out from this note, phrased as a standalone insight, or null if this note is just a routine status update with no real new understanding in it"
}

Rules:
- category must be exactly one of the enum values.
- summary is one clear sentence, no hedging, written as if for a teammate's daily digest.
- openLoops are short noun phrases, not full sentences.
- nextStep is a single next action, not a list.
- xpValue: 5-10 for small/quick items, 11-20 for solid focused work, 21-30 for a shipped feature or hard unblock.
- matchedStep must be copied EXACTLY, character-for-character, from the provided plan step list — never paraphrase it. Only set it if the note clearly indicates that step is now complete. When unsure, use null.
- lesson should be null most of the time — only set it when the note describes solving a real problem, discovering how something works, or a technique worth remembering. Routine progress updates ("finished the button styling") don't count.
- If a screenshot is attached, use what's actually visible in it (error messages, UI, code) as primary evidence for category/summary/lesson — don't just describe the image generically.
- If the note is too vague to parse confidently, still return your best-effort JSON — never ask a clarifying question, never return anything but the JSON object.`;

const PLAN_EXTRACTOR_PROMPT = `You extract a build plan from a chat message into strict JSON.

Respond with ONLY a raw JSON object, no markdown fences, no preamble, no explanation. Match this exact shape:

{
  "projectName": "short project name, 2-5 words",
  "steps": ["short imperative step", "short imperative step"]
}

Rules:
- projectName names what's being built, not the word "plan" or "project" itself.
- steps are 3-8 short imperative phrases (e.g. "Deploy staking contract to testnet"), each under 8 words, in the order they should be done.
- If the message doesn't contain a clear buildable plan, extract your best-effort interpretation of the closest thing to a plan in it — never return anything except the JSON object.`;

const LESSON_EXTRACTOR_PROMPT = `You condense a chat reply into a single short lesson.

Respond with ONLY a raw JSON object, no markdown fences, no preamble, no explanation. Match this exact shape:

{
  "lesson": "the single most useful, reusable insight or technique from the message, phrased as a standalone statement, under 15 words"
}

Rules:
- Capture one specific, reusable takeaway, not a summary of the whole message.
- If the message doesn't contain a clear technical insight, extract your best-effort interpretation of the closest thing to one — never return anything except the JSON object.`;

const COPILOT_SYSTEM_PROMPT = `You are Vibe Co-Pilot, the in-dashboard build assistant for VibeForge — a hackathon team shipping a decentralized builder-progress tracker on the Monad blockchain (Solidity contracts + a React/wagmi frontend + an LLM that parses messy notes into structured journal entries).

Answer like a sharp, fast teammate, not a customer support bot:
- Be concise and concrete. Prefer code over prose when the question is technical.
- When you show code, use fenced code blocks with a language tag.
- Default to Solidity/Foundry conventions for contract questions and React/wagmi/ethers.js conventions for frontend questions, unless told otherwise.
- If a suggestion trades off gas, security, or time-to-ship, name the tradeoff in one short line — don't lecture.
- No filler like "Great question!" — just answer.`;

// Builds the system prompt fresh each call, injecting the builder's real
// recent activity so Co-Pilot's answers can be genuinely personalized —
// not a generic assistant with no memory of what they're actually building.
function buildCopilotSystemPrompt(captures, activePlan, lessons) {
  const recentCaptures = captures
    .slice(0, 5)
    .map((c) => `- [${c.category}] ${c.summary}`)
    .join("\n");

  const planLine = activePlan
    ? `Active project: "${activePlan.projectName}" — ${
        activePlan.steps.filter((s) => s.status === "done").length
      }/${activePlan.steps.length} steps done. Pending: ${
        activePlan.steps.filter((s) => s.status === "pending").map((s) => s.label).join(", ") || "none"
      }.`
    : "No active project plan right now.";

  const lessonLines = lessons
    .slice(0, 3)
    .map((l) => `- ${l.title}`)
    .join("\n");

  return `${COPILOT_SYSTEM_PROMPT}

Here is this builder's real recent context. Use it to personalize your answer when it's actually relevant (e.g. referencing what they're building) — don't recite it back to them or force it in when it doesn't help.

Recent captures:
${recentCaptures || "None yet."}

${planLine}

Recent lessons learned:
${lessonLines || "None yet."}`;
}

const DAILY_PULSE_PROMPT = `You write a short, warm "Daily Pulse" summary for a builder, based on their real activity in the last day.

Respond with ONLY a raw JSON object, no markdown fences, no preamble, no explanation. Match this exact shape:

{
  "summary": "a warm, specific 2-3 sentence recap written directly to them ('You...'), mentioning at least one real specific thing from their activity — never generic filler"
}

Rules:
- Reference specific things from the captures/lessons given — never say something so generic it could apply to anyone.
- Keep it under 50 words.
- Encouraging tone, not corporate, not over-the-top.
- Never invent activity that wasn't given to you.`;

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

function computeBadges(lessons, plans) {
  const badges = [];
  if (lessons.length >= 1) badges.push({ id: "first-lesson", label: "First Lesson" });
  if (lessons.length >= 5) badges.push({ id: "quick-learner", label: "Quick Learner — 5 lessons" });
  if (lessons.length >= 15) badges.push({ id: "knowledge-builder", label: "Knowledge Builder — 15 lessons" });
  plans.forEach((p) => {
    if (p.steps.length > 0 && p.steps.every((s) => s.status === "done")) {
      badges.push({ id: `shipped-${p.id}`, label: `Shipped: ${p.projectName}` });
    }
  });
  return badges;
}

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

const DEFAULT_XP = 0;
const DEFAULT_NAME = "Toby";

const STORAGE_KEYS = {
  captures: "vibeforge:captures",
  totalXP: "vibeforge:total-xp",
  messages: "vibeforge:copilot-messages",
  profileName: "vibeforge:profile-name",
  plans: "vibeforge:plans",
  lessons: "vibeforge:lessons",
  dailyPulse: "vibeforge:daily-pulse",
  legacyActivePlan: "vibeforge:active-plan", // old single-plan key, read once for migration
};

/* ------------------------------------------------------------------ */
/*  API + STORAGE HELPERS                                              */
/* ------------------------------------------------------------------ */

async function callAI(system, userText, image = null) {
  // Calls our own Express server (server/index.js), which holds the real
  // Gemini API key and forwards the request — the key never reaches
  // the browser. In dev, Vite proxies /api to http://localhost:3001.
  // `image`, if provided, is a data URL string (e.g. "data:image/png;base64,...").
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, message: userText, image }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ? JSON.stringify(data.error) : "AI request failed");
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

function StreakBadge({ days }) {
  return (
    <Card className="flex items-center gap-3" style={{ padding: "10px 16px" }}>
      <Flame size={18} color="#fb923c" />
      <div>
        <div className="vf-t10" style={{ color: "var(--text-3)" }}>
          Build Streak
        </div>
        <div className="text-lg font-semibold leading-none">{days} days</div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: DASHBOARD (overview)                                          */
/* ------------------------------------------------------------------ */

function ImageAttachRow({ attachedImage, onFileSelect, onRemoveImage }) {
  const fileInputRef = useRef(null);
  return (
    <div className="w-full mb-2">
      {attachedImage && (
        <div className="mb-2" style={{ position: "relative", display: "inline-block" }}>
          <img
            src={attachedImage}
            alt="Attached screenshot"
            style={{ maxHeight: 80, borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <button
            type="button"
            onClick={onRemoveImage}
            aria-label="Remove attached image"
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "50%",
              width: 18,
              height: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <X size={10} color="var(--text-2)" />
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="vf-t10"
        onClick={() => fileInputRef.current?.click()}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: "var(--accent-light)",
        }}
      >
        <ImagePlus size={12} /> {attachedImage ? "Change screenshot" : "Attach screenshot (or paste)"}
      </button>
    </div>
  );
}

function DailyPulseCard({ pulse, isGenerating, onRefresh }) {
  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} color="var(--accent-light)" />
          <h2 className="text-base font-semibold">Daily Pulse</h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isGenerating}
          aria-label="Refresh Daily Pulse"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: isGenerating ? "default" : "pointer",
            color: "var(--text-3)",
            display: "flex",
          }}
        >
          <RefreshCw size={13} className={isGenerating ? "animate-spin" : ""} />
        </button>
      </div>
      {isGenerating ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Putting your pulse together…
        </p>
      ) : pulse?.summary ? (
        <>
          <p className="text-xs mb-3" style={{ color: "var(--text-1)" }}>
            {pulse.summary}
          </p>
          {pulse.openLoops?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {pulse.openLoops.map((loop, i) => (
                <span
                  key={i}
                  className="vf-t10 rounded-full px-2 py-0.5"
                  style={{ background: "var(--bg-surface-2)", color: "var(--text-3)" }}
                >
                  {loop}
                </span>
              ))}
            </div>
          )}
          {pulse.nextAction && (
            <p className="vf-t11" style={{ color: "var(--accent-light)" }}>
              Next tiny step: {pulse.nextAction}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Do a Vibe Capture and your morning pulse will show up here.
        </p>
      )}
    </Card>
  );
}

function DashboardView({
  profileName,
  captures,
  totalXP,
  captureText,
  setCaptureText,
  isCapturing,
  captureError,
  onCapture,
  isRecording,
  speechError,
  onToggleRecording,
  activePlan,
  isConnected,
  isLoadingChain,
  streak,
  heartbeats,
  lessons,
  attachedImage,
  onImageSelect,
  onRemoveImage,
  onImagePaste,
  dailyPulse,
  isGeneratingPulse,
  onRefreshPulse,
  goTo,
}) {
  return (
    <>
      <PageHeader
        title={`Good morning, ${profileName}.`}
        subtitle="Here's your builder pulse for today."
        right={<StreakBadge days={streak} />}
      />

      <DailyPulseCard pulse={dailyPulse} isGenerating={isGeneratingPulse} onRefresh={onRefreshPulse} />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold">Vibe Capture</h2>
            <span className="vf-pill">+{totalXP.toLocaleString()} XP</span>
          </div>
          <p className="vf-t11 mb-4" style={{ color: "var(--text-2)" }}>
            Type anything, or tap the mic to speak. Claude parses it into your build journal.
          </p>

          <div className="flex flex-col items-center py-3">
            <button
              type="button"
              className={`vf-orb mb-2 ${isRecording ? "vf-orb-recording" : ""}`}
              onClick={onToggleRecording}
              aria-label={isRecording ? "Stop recording" : "Start voice capture"}
            >
              {isRecording ? <Square size={20} color="#f87171" /> : <Mic size={26} color="var(--accent-light)" />}
            </button>
            <div className="vf-t11 mb-2" style={{ color: isRecording ? "#f87171" : "var(--text-3)", minHeight: 14 }}>
              {isRecording ? "● Recording — tap to stop" : speechError ? "Voice capture not supported in this browser" : ""}
            </div>
            <textarea
              className="vf-input vf-scrollbar mb-2"
              rows={3}
              placeholder="e.g. finally fixed the gas issue in the staking loop..."
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              onPaste={onImagePaste}
            />
            <ImageAttachRow attachedImage={attachedImage} onFileSelect={onImageSelect} onRemoveImage={onRemoveImage} />
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

        <ForgeGraphCard onExplore={() => goTo("forge")} activePlan={activePlan} lessons={lessons} captures={captures} />
        <AnalyticsCard captures={captures} compact />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ProjectsCard onViewAll={() => goTo("projects")} />
        <CopilotPreviewCard onOpen={() => goTo("copilot")} />
        <OnChainCard
          onViewAll={() => goTo("onchain")}
          isConnected={isConnected}
          isLoadingChain={isLoadingChain}
          streak={streak}
          heartbeats={heartbeats}
        />
      </div>
    </>
  );
}

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
          {c.createdAt ? formatRelativeTime(c.createdAt) : c.time}
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

function CaptureView({
  captures,
  totalXP,
  captureText,
  setCaptureText,
  isCapturing,
  captureError,
  onCapture,
  isRecording,
  speechError,
  onToggleRecording,
  attachedImage,
  onImageSelect,
  onRemoveImage,
  onImagePaste,
}) {
  return (
    <>
      <PageHeader
        title="Vibe Capture"
        subtitle="Dump anything, speak it, or paste a screenshot. Claude turns it into a structured journal entry."
        right={<span className="vf-pill">+{totalXP.toLocaleString()} XP total</span>}
      />
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="flex flex-col items-center py-4">
            <button
              type="button"
              className={`vf-orb mb-2 ${isRecording ? "vf-orb-recording" : ""}`}
              onClick={onToggleRecording}
              aria-label={isRecording ? "Stop recording" : "Start voice capture"}
            >
              {isRecording ? <Square size={20} color="#f87171" /> : <Mic size={26} color="var(--accent-light)" />}
            </button>
            <div className="vf-t11 mb-2" style={{ color: isRecording ? "#f87171" : "var(--text-3)", minHeight: 14 }}>
              {isRecording ? "● Recording — tap to stop" : speechError ? "Voice capture not supported in this browser" : ""}
            </div>
            <textarea
              className="vf-input vf-scrollbar mb-2"
              rows={6}
              placeholder="e.g. finally fixed the gas issue in the staking loop, still need to wire up the frontend event listener..."
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              onPaste={onImagePaste}
            />
            <ImageAttachRow attachedImage={attachedImage} onFileSelect={onImageSelect} onRemoveImage={onRemoveImage} />
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

function mostFrequentCategory(items) {
  const counts = {};
  items.forEach((i) => {
    counts[i.category] = (counts[i.category] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : null;
}

function ForgeGraphCard({ onExplore, full, activePlan, lessons = [], captures = [] }) {
  const hasPlan = activePlan && activePlan.steps.length > 0;
  const knowledgeSource = lessons.length > 0 ? lessons : captures;
  const hasKnowledge = !hasPlan && knowledgeSource.length > 0;

  let nodes;
  let centerLabel;

  if (hasPlan) {
    nodes = activePlan.steps.map((s, i) => ({
      angle: -90 + (360 / activePlan.steps.length) * i,
      done: s.status === "done",
      top: s.status === "done" ? "✓ Done" : "Pending",
      sub: s.label,
    }));
    centerLabel = activePlan.projectName;
  } else if (hasKnowledge) {
    const items = knowledgeSource.slice(0, 6);
    nodes = items.map((item, i) => ({
      angle: -90 + (360 / items.length) * i,
      done: false,
      top: item.category,
      sub: item.title || item.summary,
    }));
    centerLabel = mostFrequentCategory(captures) ? `Your ${mostFrequentCategory(captures)} Work` : "Your Knowledge";
  } else {
    nodes = KNOWLEDGE_NODES.map((n) => ({ angle: n.angle, done: false, top: n.label, sub: n.sub }));
    centerLabel = "Staking DApp";
  }

  const doneCount = hasPlan ? activePlan.steps.filter((s) => s.status === "done").length : 0;
  const nextPending = hasPlan ? activePlan.steps.find((s) => s.status === "pending") : null;

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
          {nodes.map((n, i) => {
            const rad = (n.angle * Math.PI) / 180;
            const x = 50 + 33 * Math.cos(rad);
            const y = 50 + 33 * Math.sin(rad);
            return (
              <line
                key={i}
                x1="50"
                y1="50"
                x2={x}
                y2={y}
                stroke={n.done ? "var(--accent)" : "var(--border)"}
                strokeWidth="0.6"
              />
            );
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
          {centerLabel}
        </div>
        {nodes.map((n, i) => {
          const rad = (n.angle * Math.PI) / 180;
          const x = 50 + 33 * Math.cos(rad);
          const y = 50 + 33 * Math.sin(rad);
          return (
            <div
              key={i}
              className="vf-node"
              style={n.done ? { top: `${y}%`, left: `${x}%`, borderColor: "var(--green)" } : { top: `${y}%`, left: `${x}%` }}
            >
              <div style={{ fontWeight: 600, color: n.done ? "var(--green)" : "var(--text-1)" }}>{n.top}</div>
              <div style={{ color: "var(--text-3)" }}>{n.sub}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        {hasPlan ? (
          <>
            <div className="vf-t11 font-medium mb-1" style={{ color: "var(--accent-light)" }}>
              {doneCount} of {activePlan.steps.length} steps complete
            </div>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              {nextPending ? `Next up: ${nextPending.label}` : "All steps complete — nice work."}
            </p>
          </>
        ) : hasKnowledge ? (
          <>
            <div className="vf-t11 font-medium mb-1" style={{ color: "var(--accent-light)" }}>
              Your recent knowledge
            </div>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Ask Vibe Co-Pilot for a plan to turn this into a tracked project.
            </p>
          </>
        ) : (
          <>
            <div className="vf-t11 font-medium mb-1" style={{ color: "var(--accent-light)" }}>
              No activity yet
            </div>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Do a Vibe Capture or ask Co-Pilot for a plan to see your real Forge here.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function ForgeView({ plans, activePlan, onSwitchPlan, onDeletePlan, lessons, captures }) {
  const hasPlan = activePlan && activePlan.steps.length > 0;
  return (
    <>
      <PageHeader
        title="My Forge"
        subtitle={hasPlan ? `Your live plan for ${activePlan.projectName}.` : "Your personal knowledge graph."}
      />
      {plans.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {plans.map((p) => {
            const done = p.steps.filter((s) => s.status === "done").length;
            const isActive = activePlan && p.id === activePlan.id;
            return (
              <div
                key={p.id}
                onClick={() => onSwitchPlan(p.id)}
                className="flex items-center gap-2 rounded-full vf-t11"
                style={{
                  cursor: "pointer",
                  padding: "6px 8px 6px 12px",
                  background: isActive ? "var(--accent-dim)" : "var(--bg-surface-2)",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  color: isActive ? "var(--accent-light)" : "var(--text-2)",
                }}
              >
                <span style={{ fontWeight: isActive ? 600 : 500 }}>{p.projectName}</span>
                <span style={{ color: "var(--text-3)" }}>
                  {done}/{p.steps.length}
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${p.projectName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePlan(p.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 2,
                    cursor: "pointer",
                    color: "var(--text-3)",
                    display: "flex",
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <ForgeGraphCard full activePlan={activePlan} lessons={lessons} captures={captures} />
        </div>
        <Card>
          <div className="text-sm font-medium mb-3">
            {hasPlan ? "Steps" : lessons.length > 0 ? "Recent Lessons" : "Node Legend"}
          </div>
          <div className="flex flex-col gap-2">
            {hasPlan
              ? activePlan.steps.map((s) => (
                  <div key={s.id} className="vf-t11" style={{ color: s.status === "done" ? "var(--green)" : "var(--text-1)" }}>
                    {s.status === "done" ? "✓ " : "○ "}
                    {s.label}
                  </div>
                ))
              : lessons.length > 0
              ? lessons.slice(0, 6).map((l) => (
                  <div key={l.id} className="flex items-center justify-between vf-t11">
                    <span style={{ color: "var(--text-1)" }}>{l.title}</span>
                    <CategoryPill category={l.category} />
                  </div>
                ))
              : KNOWLEDGE_NODES.map((n) => (
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

function LearningView({ lessons, plans }) {
  const badges = computeBadges(lessons, plans);
  return (
    <>
      <PageHeader
        title="Learning"
        subtitle="Lessons and badges, captured automatically as you build."
      />
      <Card className="mb-4">
        <div className="text-sm font-medium">Your learning log</div>
        <div className="vf-t11" style={{ color: "var(--text-3)" }}>
          {lessons.length} lesson{lessons.length === 1 ? "" : "s"} captured · {badges.length} badge
          {badges.length === 1 ? "" : "s"} earned
        </div>
      </Card>
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <div className="text-sm font-medium mb-3">Lessons</div>
          {lessons.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              No lessons yet. Lessons are captured automatically when a Vibe Capture reflects
              something you actually figured out — or save one from a useful Co-Pilot reply.
            </p>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto vf-scrollbar pr-1" style={{ maxHeight: 480 }}>
              {lessons.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg p-3"
                  style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <CategoryPill category={l.category} />
                    <span className="vf-t10" style={{ color: "var(--text-3)" }}>
                      {new Date(l.capturedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-1)" }}>
                    {l.title}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3">Badges</div>
          {badges.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Badges unlock as you learn and ship. Nothing yet — keep building.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-lg p-2.5"
                  style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border)" }}
                >
                  <CheckCircle2 size={14} color="var(--green)" />
                  <span className="vf-t11" style={{ color: "var(--text-1)" }}>
                    {b.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: CO-PILOT                                                      */
/* ------------------------------------------------------------------ */

function ChatPanel({
  messages,
  input,
  setInput,
  isLoading,
  onSend,
  height,
  savingMessageIndex,
  savedMessageIndices,
  onSaveAsPlan,
  savingLessonIndex,
  savedLessonIndices,
  onSaveAsLesson,
}) {
  const chatEndRef = useRef(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="flex flex-col" style={{ height }}>
      <div className="flex-1 overflow-y-auto vf-scrollbar flex flex-col gap-1 pr-1">
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              className="rounded-lg p-2.5 text-xs whitespace-pre-wrap mb-1"
              style={{
                background: m.role === "user" ? "var(--accent-dim)" : "var(--bg-surface-2)",
                border: "1px solid var(--border)",
                maxWidth: "85%",
                color: m.role === "user" ? "var(--accent-light)" : "var(--text-1)",
              }}
            >
              {m.content}
            </div>
            {m.role === "assistant" && i > 0 && (onSaveAsPlan || onSaveAsLesson) && (
              <div className="flex items-center gap-3 mb-2">
                {onSaveAsPlan && (
                  <button
                    type="button"
                    className="vf-t10"
                    onClick={() => onSaveAsPlan(i, m.content)}
                    disabled={savingMessageIndex === i}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: savingMessageIndex === i ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: savedMessageIndices?.has(i) ? "var(--green)" : "var(--accent-light)",
                    }}
                  >
                    {savingMessageIndex === i ? (
                      <>
                        <Loader2 size={11} className="animate-spin" /> Saving…
                      </>
                    ) : savedMessageIndices?.has(i) ? (
                      <>
                        <CheckCircle2 size={11} /> Saved to My Forge
                      </>
                    ) : (
                      <>
                        <LayoutGrid size={11} /> Save as Forge plan
                      </>
                    )}
                  </button>
                )}
                {onSaveAsLesson && (
                  <button
                    type="button"
                    className="vf-t10"
                    onClick={() => onSaveAsLesson(i, m.content)}
                    disabled={savingLessonIndex === i}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: savingLessonIndex === i ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: savedLessonIndices?.has(i) ? "var(--green)" : "var(--accent-light)",
                    }}
                  >
                    {savingLessonIndex === i ? (
                      <>
                        <Loader2 size={11} className="animate-spin" /> Saving…
                      </>
                    ) : savedLessonIndices?.has(i) ? (
                      <>
                        <CheckCircle2 size={11} /> Saved to Learning
                      </>
                    ) : (
                      <>
                        <BookOpen size={11} /> Save as Lesson
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
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

function CopilotView({
  messages,
  input,
  setInput,
  isLoading,
  onSend,
  savingMessageIndex,
  savedMessageIndices,
  onSaveAsPlan,
  savingLessonIndex,
  savedLessonIndices,
  onSaveAsLesson,
}) {
  return (
    <>
      <PageHeader title="Vibe Co-Pilot" subtitle="Your build assistant. Save any plan or lesson worth keeping." />
      <ChatPanel
        messages={messages}
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        onSend={onSend}
        height={560}
        savingMessageIndex={savingMessageIndex}
        savedMessageIndices={savedMessageIndices}
        onSaveAsPlan={onSaveAsPlan}
        savingLessonIndex={savingLessonIndex}
        savedLessonIndices={savedLessonIndices}
        onSaveAsLesson={onSaveAsLesson}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE: ON-CHAIN                                                      */
/* ------------------------------------------------------------------ */

function OnChainCard({ onViewAll, full, isConnected, isLoadingChain, streak, heartbeats }) {
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
          <div className="text-2xl font-semibold leading-none">{streak} days</div>
          <div className="vf-t11 mt-1" style={{ color: "var(--text-3)" }}>
            {isConnected ? "Keep building to extend your streak." : "Connect your wallet to see your real streak."}
          </div>
        </div>
      </div>
      <div className="text-xs font-medium mb-2">Recent On-Chain Activity</div>
      <div className="flex flex-col gap-2 mb-3">
        {!isConnected && (
          <p className="vf-t11" style={{ color: "var(--text-3)" }}>
            Connect your wallet to load your on-chain heartbeats.
          </p>
        )}
        {isConnected && isLoadingChain && (
          <p className="vf-t11" style={{ color: "var(--text-3)" }}>
            Loading from Monad Testnet…
          </p>
        )}
        {isConnected && !isLoadingChain && heartbeats.length === 0 && (
          <p className="vf-t11" style={{ color: "var(--text-3)" }}>
            No heartbeats logged yet — do a capture to mint your first one.
          </p>
        )}
        {heartbeats.slice(0, 5).map((h, i) => (
          <div key={i} className="flex items-center justify-between vf-t11">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={13} color="var(--green)" />
              <div>
                <div style={{ color: "var(--text-1)" }}>{h.summary}</div>
                <div style={{ color: "var(--text-3)" }}>
                  {h.category} · +{h.xpReward} XP
                </div>
              </div>
            </div>
            <span style={{ color: "var(--text-3)" }}>{new Date(h.timestamp).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
      <a
        href="https://testnet.monadexplorer.com"
        target="_blank"
        rel="noreferrer"
        className="vf-btn-primary w-full justify-center"
        style={{ background: "var(--bg-surface-2)", color: "var(--text-2)", textDecoration: "none" }}
      >
        View all on Monad Explorer <ExternalLink size={12} />
      </a>
    </Card>
  );
}

function SoulCard({ isConnected, isLoadingSoul, soul }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Builder Soul</h2>
      </div>
      {!SOUL_CONTRACT_ADDRESS ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          No VITE_SOUL_CONTRACT_ADDRESS set yet — add it to .env once the Soul contract is deployed.
        </p>
      ) : !isConnected ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Connect your wallet to see your Soul.
        </p>
      ) : isLoadingSoul ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Loading from Monad Testnet…
        </p>
      ) : !soul ? (
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          No Soul minted yet — your first Capture with a connected wallet mints one automatically.
        </p>
      ) : (
        <>
          <img
            src={soul.imageDataUri}
            alt={soul.name}
            style={{ width: "100%", borderRadius: 12, border: "1px solid var(--border)" }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {soul.attributes.map((a) => (
              <span key={a.trait_type} className="vf-pill">
                {a.trait_type}: {String(a.value)}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function OnChainView({ isConnected, isLoadingChain, streak, heartbeats, isLoadingSoul, soul }) {
  return (
    <>
      <PageHeader
        title="On-Chain"
        subtitle={
          CONTRACT_ADDRESS
            ? "Reads and writes go to your deployed DeveloperHeartbeat contract on Monad Testnet."
            : "No VITE_CONTRACT_ADDRESS set yet — add it to .env once Builder A's contract is deployed."
        }
      />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <OnChainCard full isConnected={isConnected} isLoadingChain={isLoadingChain} streak={streak} heartbeats={heartbeats} />
        </div>
        <SoulCard isConnected={isConnected} isLoadingSoul={isLoadingSoul} soul={soul} />
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

function SettingsView({
  profileName,
  setProfileName,
  onReset,
  syncStatus,
  isConnected,
  address,
  onConnect,
  onDisconnect,
  cloudEnabled,
  cloudSyncStatus,
}) {
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
          <input className="vf-input mb-2" value={isConnected ? address : "Not connected"} disabled />
          {isConnected ? (
            <button
              className="vf-btn-primary"
              style={{ background: "var(--bg-surface-2)", color: "var(--text-2)" }}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          ) : (
            <button className="vf-btn-primary" onClick={onConnect}>
              Connect Wallet
            </button>
          )}
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
            Captures, XP, and your Co-Pilot chat are saved to your browser and persist across
            sessions on this device.
          </p>
          <button
            className="vf-btn-primary"
            style={{ background: "var(--bg-surface-2)", color: "#f87171" }}
            onClick={onReset}
          >
            <RotateCcw size={13} /> Reset local data
          </button>
        </Card>
        <Card className="col-span-2">
          <div className="text-sm font-medium mb-3">Cloud sync</div>
          {!cloudEnabled && (
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable syncing
              across devices.
            </p>
          )}
          {cloudEnabled && !isConnected && (
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Connect your wallet above to sync your data across devices.
            </p>
          )}
          {cloudEnabled && isConnected && (
            <div className="flex items-center gap-2 vf-t11" style={{ color: "var(--text-3)" }}>
              {cloudSyncStatus === "synced" && <Cloud size={14} color="var(--green)" />}
              {cloudSyncStatus === "syncing" && <Loader2 size={14} className="animate-spin" />}
              {cloudSyncStatus === "error" && <CloudOff size={14} color="#f87171" />}
              {cloudSyncStatus === "synced" && "Synced to your wallet"}
              {cloudSyncStatus === "syncing" && "Syncing…"}
              {cloudSyncStatus === "error" && "Couldn't sync — will retry on next change"}
              {cloudSyncStatus === "idle" && "Waiting for first sync…"}
            </div>
          )}
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
  const [isRecording, setIsRecording] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const recognitionRef = useRef(null);

  const [messages, setMessages] = useState(DEFAULT_MESSAGES);
  const [copilotInput, setCopilotInput] = useState("");
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);

  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const activePlan = plans.find((p) => p.id === activePlanId) || null;
  const [savingMessageIndex, setSavingMessageIndex] = useState(null);
  const [savedMessageIndices, setSavedMessageIndices] = useState(() => new Set());

  const [lessons, setLessons] = useState([]);
  const [savingLessonIndex, setSavingLessonIndex] = useState(null);
  const [savedLessonIndices, setSavedLessonIndices] = useState(() => new Set());

  const [attachedImage, setAttachedImage] = useState(null); // data URL or null

  const [dailyPulse, setDailyPulse] = useState(null); // { date, summary, openLoops, nextAction }
  const [isGeneratingPulse, setIsGeneratingPulse] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const { heartbeats, streak, isLoading: isLoadingChain } = useHeartbeats();
  const { soul, isLoading: isLoadingSoul, refresh: refreshSoul } = useSoul();

  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const cloudEnabled = Boolean(supabase);

  /* ---- image attach: file picker + clipboard paste ---- */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFileSelect(file) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setAttachedImage(dataUrl);
    } catch (err) {
      console.error("Failed to read image:", err);
    }
  }

  async function handleImagePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await handleImageFileSelect(file);
        }
        break;
      }
    }
  }

  function handleRemoveImage() {
    setAttachedImage(null);
  }

  /* ---- stop any active recording if the component unmounts ---- */
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  /* ---- voice capture via the browser's built-in speech recognition ---- */
  function toggleRecording() {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setSpeechError(true);
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    setSpeechError(false);
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    const baseText = captureText.trim() ? captureText.trim() + " " : "";
    let finalTranscript = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      setCaptureText((baseText + finalTranscript + interim).trim());
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Could not start recording:", err);
      setSpeechError(true);
    }
  }

  /* ---- load persisted data once on mount ---- */
  useEffect(() => {
    const startedAt = Date.now();
    (async () => {
      const [capturesRaw, xpRaw, messagesRaw, nameRaw, plansRaw, legacyPlanRaw, lessonsRaw, pulseRaw] = await Promise.all([
        safeGet(STORAGE_KEYS.captures),
        safeGet(STORAGE_KEYS.totalXP),
        safeGet(STORAGE_KEYS.messages),
        safeGet(STORAGE_KEYS.profileName),
        safeGet(STORAGE_KEYS.plans),
        safeGet(STORAGE_KEYS.legacyActivePlan),
        safeGet(STORAGE_KEYS.lessons),
        safeGet(STORAGE_KEYS.dailyPulse),
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

      if (plansRaw) {
        try {
          const parsed = JSON.parse(plansRaw);
          setPlans(Array.isArray(parsed.plans) ? parsed.plans : []);
          setActivePlanId(parsed.activePlanId || null);
        } catch (e) {}
      } else if (legacyPlanRaw) {
        // one-time migration from the old single-plan format
        try {
          const old = JSON.parse(legacyPlanRaw);
          const migrated = { ...old, id: old.id || `plan-${Date.now()}` };
          setPlans([migrated]);
          setActivePlanId(migrated.id);
        } catch (e) {}
      }

      if (lessonsRaw) {
        try {
          setLessons(JSON.parse(lessonsRaw));
        } catch (e) {}
      }

      if (pulseRaw) {
        try {
          setDailyPulse(JSON.parse(pulseRaw));
        } catch (e) {}
      }

      const elapsed = Date.now() - startedAt;
      const MIN_SPLASH_MS = 2000;
      if (elapsed < MIN_SPLASH_MS) {
        await new Promise((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
      }
      setIsLoaded(true);
    })();
  }, []);

  /* ---- persist locally on change, after initial load ---- */
  useEffect(() => {
    if (!isLoaded) return;
    setSyncStatus("saving");
    Promise.all([
      safeSet(STORAGE_KEYS.captures, JSON.stringify(captures)),
      safeSet(STORAGE_KEYS.totalXP, JSON.stringify(totalXP)),
      safeSet(STORAGE_KEYS.messages, JSON.stringify(messages)),
      safeSet(STORAGE_KEYS.profileName, profileName),
      safeSet(STORAGE_KEYS.plans, JSON.stringify({ plans, activePlanId })),
      safeSet(STORAGE_KEYS.lessons, JSON.stringify(lessons)),
      safeSet(STORAGE_KEYS.dailyPulse, JSON.stringify(dailyPulse)),
    ]).then((results) => {
      setSyncStatus(results.every(Boolean) ? "saved" : "error");
    });
  }, [captures, totalXP, messages, profileName, plans, activePlanId, lessons, dailyPulse, isLoaded]);

  /* ---- push to Supabase whenever data changes, if a wallet is connected ---- */
  useEffect(() => {
    if (!isLoaded || !cloudEnabled || !isConnected || !address) return;
    setCloudSyncStatus("syncing");
    saveCloudData(address, { captures, totalXP, messages, profileName, plans, activePlanId, lessons, dailyPulse }).then(
      (ok) => {
        setCloudSyncStatus(ok ? "synced" : "error");
      }
    );
  }, [captures, totalXP, messages, profileName, plans, activePlanId, lessons, dailyPulse, isLoaded, cloudEnabled, isConnected, address]);

  /* ---- on wallet connect: load existing cloud data, or seed the cloud with local data ---- */
  useEffect(() => {
    if (!isLoaded || !cloudEnabled || !isConnected || !address) return;
    (async () => {
      setCloudSyncStatus("syncing");
      const cloud = await loadCloudData(address);
      if (cloud) {
        if (Array.isArray(cloud.captures)) setCaptures(cloud.captures);
        if (typeof cloud.totalXP === "number") setTotalXP(cloud.totalXP);
        if (Array.isArray(cloud.messages)) setMessages(cloud.messages);
        if (cloud.profileName) setProfileName(cloud.profileName);
        if (Array.isArray(cloud.plans)) setPlans(cloud.plans);
        if (cloud.activePlanId !== undefined) setActivePlanId(cloud.activePlanId);
        if (Array.isArray(cloud.lessons)) setLessons(cloud.lessons);
        if (cloud.dailyPulse) setDailyPulse(cloud.dailyPulse);
        setCloudSyncStatus("synced");
      } else {
        const ok = await saveCloudData(address, {
          captures,
          totalXP,
          messages,
          profileName,
          plans,
          activePlanId,
          lessons,
          dailyPulse,
        });
        setCloudSyncStatus(ok ? "synced" : "error");
      }
    })();
    // Only re-run when the connected wallet itself changes, not on every local edit —
    // the effect above already handles pushing ongoing changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, cloudEnabled, isLoaded]);

  function findMatchingStepIndex(steps, matchedStep) {
    if (!matchedStep) return -1;
    const target = String(matchedStep).toLowerCase().trim();
    let idx = steps.findIndex((s) => s.status === "pending" && s.label.toLowerCase().trim() === target);
    if (idx !== -1) return idx;
    idx = steps.findIndex(
      (s) => s.status === "pending" && (s.label.toLowerCase().includes(target) || target.includes(s.label.toLowerCase()))
    );
    return idx;
  }

  function buildCaptureMessage(text, plan) {
    const pending = plan ? plan.steps.filter((s) => s.status === "pending") : [];
    if (pending.length === 0) return text;
    const list = pending.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return `${text}\n\n---\nCurrent plan for "${plan.projectName}" — pending steps:\n${list}`;
  }

  async function handleCapture() {
    if (!captureText.trim() || isCapturing) return;
    if (isRecording) recognitionRef.current?.stop();
    setIsCapturing(true);
    setCaptureError(false);
    try {
      const raw = await callAI(VIBE_PARSER_PROMPT, buildCaptureMessage(captureText, activePlan), attachedImage);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const now = Date.now();
      const entry = {
        id: now,
        category: parsed.category || "Other",
        summary: parsed.summary || captureText.slice(0, 100),
        openLoops: Array.isArray(parsed.openLoops) ? parsed.openLoops : [],
        nextStep: parsed.nextStep || "",
        xpValue: Number.isFinite(parsed.xpValue) ? parsed.xpValue : 10,
        time: "Just now",
        createdAt: now,
      };
      setCaptures((prev) => [entry, ...prev]);
      setTotalXP((prev) => prev + entry.xpValue);
      setCaptureText("");
      setAttachedImage(null);

      if (parsed.matchedStep && activePlan) {
        setPlans((prev) =>
          prev.map((p) => {
            if (p.id !== activePlan.id) return p;
            const idx = findMatchingStepIndex(p.steps, parsed.matchedStep);
            if (idx === -1) return p;
            const nextSteps = [...p.steps];
            nextSteps[idx] = { ...nextSteps[idx], status: "done", linkedCaptureId: entry.id };
            return { ...p, steps: nextSteps };
          })
        );
      }

      if (parsed.lesson) {
        setLessons((prev) => [
          {
            id: `lesson-${Date.now()}`,
            title: String(parsed.lesson),
            category: entry.category,
            capturedAt: Date.now(),
            sourceCaptureId: entry.id,
          },
          ...prev,
        ]);

        // Optional: also log the lesson on-chain. Only succeeds if the deployed
        // Soul contract includes logLesson — safe to leave in even if it doesn't,
        // the failure is caught and the local/cloud lesson is already saved either way.
        if (isConnected && SOUL_CONTRACT_ADDRESS) {
          try {
            await writeContractAsync({
              address: SOUL_CONTRACT_ADDRESS,
              abi: SOUL_ABI,
              functionName: "logLesson",
              args: [entry.category, String(parsed.lesson)],
            });
          } catch (lessonErr) {
            console.error("On-chain lesson log failed (contract may need redeploy with logLesson support):", lessonErr);
          }
        }
      }

      if (isConnected && CONTRACT_ADDRESS) {
        try {
          await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: HEARTBEAT_ABI,
            functionName: "logHeartbeat",
            args: [entry.category, entry.summary, BigInt(entry.xpValue)],
          });
        } catch (chainErr) {
          console.error("On-chain log failed:", chainErr);
          // capture is already saved locally even if the tx is rejected or fails
        }
      }

      if (isConnected && SOUL_CONTRACT_ADDRESS) {
        try {
          await writeContractAsync({
            address: SOUL_CONTRACT_ADDRESS,
            abi: SOUL_ABI,
            functionName: "logProgress",
            args: [entry.category, BigInt(entry.xpValue)],
          });
          refreshSoul();
        } catch (soulErr) {
          console.error("Soul NFT update failed:", soulErr);
        }
      }
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
      const reply = await callAI(buildCopilotSystemPrompt(captures, activePlan, lessons), copilotInput);
      setMessages((prev) => [...prev, { role: "assistant", content: reply || "…" }]);
    } catch (err) {
      console.error("Co-Pilot error:", err);
      setMessages((prev) => [...prev, { role: "assistant", content: "Couldn't reach the model just now — try again." }]);
    } finally {
      setIsCopilotLoading(false);
    }
  }

  async function handleSaveAsPlan(messageIndex, content) {
    setSavingMessageIndex(messageIndex);
    try {
      const raw = await callAI(PLAN_EXTRACTOR_PROMPT, content);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 8).map((label, i) => ({
        id: `step-${Date.now()}-${i}`,
        label: String(label),
        status: "pending",
        linkedCaptureId: null,
      }));
      if (steps.length === 0) throw new Error("No steps extracted");
      const newPlan = {
        id: `plan-${Date.now()}`,
        projectName: parsed.projectName || "Untitled Project",
        steps,
        createdAt: Date.now(),
      };
      setPlans((prev) => [newPlan, ...prev]);
      setActivePlanId(newPlan.id);
      setSavedMessageIndices((prev) => new Set(prev).add(messageIndex));
    } catch (err) {
      console.error("Failed to save plan:", err);
    } finally {
      setSavingMessageIndex(null);
    }
  }

  async function handleSaveAsLesson(messageIndex, content) {
    setSavingLessonIndex(messageIndex);
    try {
      const raw = await callAI(LESSON_EXTRACTOR_PROMPT, content);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed.lesson) throw new Error("No lesson extracted");
      setLessons((prev) => [
        {
          id: `lesson-${Date.now()}`,
          title: String(parsed.lesson),
          category: "Co-Pilot",
          capturedAt: Date.now(),
          sourceCaptureId: null,
        },
        ...prev,
      ]);
      setSavedLessonIndices((prev) => new Set(prev).add(messageIndex));

      if (isConnected && SOUL_CONTRACT_ADDRESS) {
        try {
          await writeContractAsync({
            address: SOUL_CONTRACT_ADDRESS,
            abi: SOUL_ABI,
            functionName: "logLesson",
            args: ["Co-Pilot", String(parsed.lesson)],
          });
        } catch (lessonErr) {
          console.error("On-chain lesson log failed (contract may need redeploy with logLesson support):", lessonErr);
        }
      }
    } catch (err) {
      console.error("Failed to save lesson:", err);
    } finally {
      setSavingLessonIndex(null);
    }
  }

  async function generateDailyPulse() {
    if (isGeneratingPulse) return;
    setIsGeneratingPulse(true);
    try {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const windowCaptures = captures.filter((c) => c.createdAt && c.createdAt >= oneDayAgo);
      const windowLessons = lessons.filter((l) => l.capturedAt && l.capturedAt >= oneDayAgo);

      const openLoops = [...new Set(windowCaptures.flatMap((c) => c.openLoops || []))].slice(0, 5);
      const nextAction =
        (activePlan && activePlan.steps.find((s) => s.status === "pending")?.label) ||
        windowCaptures[0]?.nextStep ||
        "Do a Vibe Capture to kick off today's context.";

      const today = new Date().toDateString();

      if (windowCaptures.length === 0 && windowLessons.length === 0) {
        setDailyPulse({
          date: today,
          summary: "No activity in the last day yet — do a capture and your next pulse will actually reflect it.",
          openLoops: [],
          nextAction,
        });
        return;
      }

      const activityText = [
        ...windowCaptures.map((c) => `Capture [${c.category}]: ${c.summary}`),
        ...windowLessons.map((l) => `Lesson: ${l.title}`),
      ].join("\n");

      const raw = await callAI(DAILY_PULSE_PROMPT, activityText);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      setDailyPulse({
        date: today,
        summary: parsed.summary || "You made progress in the last day — keep it going.",
        openLoops,
        nextAction,
      });
    } catch (err) {
      console.error("Failed to generate Daily Pulse:", err);
    } finally {
      setIsGeneratingPulse(false);
    }
  }

  /* ---- auto-generate the Daily Pulse once per day, once data is loaded ---- */
  useEffect(() => {
    if (!isLoaded) return;
    const today = new Date().toDateString();
    if (dailyPulse?.date === today) return;
    generateDailyPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  function handleSwitchPlan(id) {
    setActivePlanId(id);
  }

  function handleDeletePlan(id) {
    const remaining = plans.filter((p) => p.id !== id);
    setPlans(remaining);
    if (activePlanId === id) {
      setActivePlanId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  async function handleReset() {
    await Promise.all([
      safeDelete(STORAGE_KEYS.captures),
      safeDelete(STORAGE_KEYS.totalXP),
      safeDelete(STORAGE_KEYS.messages),
      safeDelete(STORAGE_KEYS.profileName),
      safeDelete(STORAGE_KEYS.plans),
      safeDelete(STORAGE_KEYS.legacyActivePlan),
      safeDelete(STORAGE_KEYS.lessons),
      safeDelete(STORAGE_KEYS.dailyPulse),
    ]);
    setCaptures(DEFAULT_CAPTURES);
    setTotalXP(DEFAULT_XP);
    setMessages(DEFAULT_MESSAGES);
    setProfileName(DEFAULT_NAME);
    setPlans([]);
    setActivePlanId(null);
    setSavedMessageIndices(new Set());
    setLessons([]);
    setSavedLessonIndices(new Set());
    setDailyPulse(null);
    setAttachedImage(null);

    if (cloudEnabled && isConnected && address) {
      await saveCloudData(address, {
        captures: DEFAULT_CAPTURES,
        totalXP: DEFAULT_XP,
        messages: DEFAULT_MESSAGES,
        profileName: DEFAULT_NAME,
        plans: [],
        activePlanId: null,
        lessons: [],
        dailyPulse: null,
      });
    }
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
            isRecording={isRecording}
            speechError={speechError}
            onToggleRecording={toggleRecording}
            activePlan={activePlan}
            isConnected={isConnected}
            isLoadingChain={isLoadingChain}
            streak={streak}
            heartbeats={heartbeats}
            lessons={lessons}
            attachedImage={attachedImage}
            onImageSelect={handleImageFileSelect}
            onRemoveImage={handleRemoveImage}
            onImagePaste={handleImagePaste}
            dailyPulse={dailyPulse}
            isGeneratingPulse={isGeneratingPulse}
            onRefreshPulse={generateDailyPulse}
            goTo={setActiveNav}
          />
        );
      case "forge":
        return (
          <ForgeView
            plans={plans}
            activePlan={activePlan}
            onSwitchPlan={handleSwitchPlan}
            onDeletePlan={handleDeletePlan}
            lessons={lessons}
            captures={captures}
          />
        );
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
            isRecording={isRecording}
            speechError={speechError}
            onToggleRecording={toggleRecording}
            attachedImage={attachedImage}
            onImageSelect={handleImageFileSelect}
            onRemoveImage={handleRemoveImage}
            onImagePaste={handleImagePaste}
          />
        );
      case "projects":
        return <ProjectsView />;
      case "learning":
        return <LearningView lessons={lessons} plans={plans} />;
      case "copilot":
        return (
          <CopilotView
            messages={messages}
            input={copilotInput}
            setInput={setCopilotInput}
            isLoading={isCopilotLoading}
            onSend={handleCopilotSend}
            savingMessageIndex={savingMessageIndex}
            savedMessageIndices={savedMessageIndices}
            onSaveAsPlan={handleSaveAsPlan}
            savingLessonIndex={savingLessonIndex}
            savedLessonIndices={savedLessonIndices}
            onSaveAsLesson={handleSaveAsLesson}
          />
        );
      case "onchain":
        return (
          <OnChainView
            isConnected={isConnected}
            isLoadingChain={isLoadingChain}
            streak={streak}
            heartbeats={heartbeats}
            isLoadingSoul={isLoadingSoul}
            soul={soul}
          />
        );
      case "analytics":
        return <AnalyticsView captures={captures} />;
      case "settings":
        return (
          <SettingsView
            profileName={profileName}
            setProfileName={setProfileName}
            onReset={handleReset}
            syncStatus={syncStatus}
            isConnected={isConnected}
            address={address}
            onConnect={() => connect({ connector: injected() })}
            onDisconnect={() => disconnect()}
            cloudEnabled={cloudEnabled}
            cloudSyncStatus={cloudSyncStatus}
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
          background: transparent;
          padding: 0;
          cursor: pointer;
          box-shadow: 0 0 32px var(--accent-dim), inset 0 0 24px var(--accent-dim);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: vf-pulse 2.8s ease-in-out infinite;
          transition: border-color 0.2s;
        }
        .vf-orb:hover { border-color: var(--accent-light); }
        @keyframes vf-pulse {
          0%, 100% { box-shadow: 0 0 24px var(--accent-dim), inset 0 0 18px var(--accent-dim); }
          50% { box-shadow: 0 0 44px var(--accent-dim), inset 0 0 30px var(--accent-dim); }
        }
        .vf-orb-recording {
          border-color: #f87171;
          animation: vf-pulse-recording 1s ease-in-out infinite;
        }
        @keyframes vf-pulse-recording {
          0%, 100% { box-shadow: 0 0 24px rgba(248,113,113,0.25), inset 0 0 18px rgba(248,113,113,0.25); }
          50% { box-shadow: 0 0 50px rgba(248,113,113,0.45), inset 0 0 34px rgba(248,113,113,0.45); }
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
              {isConnected ? (
                <div
                  className="vf-t10 vf-link"
                  style={{ color: "var(--text-3)" }}
                  onClick={() => disconnect()}
                  title="Click to disconnect"
                >
                  {address.slice(0, 6)}…{address.slice(-4)}
                </div>
              ) : (
                <button
                  type="button"
                  className="vf-t10 vf-link"
                  onClick={() => connect({ connector: injected() })}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--accent-light)",
                  }}
                >
                  Connect Wallet
                </button>
              )}
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