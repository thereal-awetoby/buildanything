import React from "react";
import VibeForgeLogo from "./VibeForgeLogo";

const WORD = "VibeForge";
const VIBE_LEN = 4; // letters 0-3 are "Vibe", 4-8 are "Forge"

export default function SplashScreen({ label = "Loading your forge…" }) {
  return (
    <div className="vf-splash">
      <style>{`
        .vf-splash {
          height: 100%; min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 28px; background: #08080c;
        }
        .vf-splash-lockup {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }
        .vf-splash-logo {
          flex-shrink: 0;
          animation: vf-flicker 2.6s linear infinite;
        }
        @keyframes vf-flicker {
          0%, 3%, 6%, 9%, 45%, 48%, 70%, 100% {
            opacity: 1;
            filter: drop-shadow(0 0 10px rgba(124,92,252,0.55)) drop-shadow(0 0 26px rgba(124,92,252,0.35));
          }
          4%, 8%, 46%, 71% { opacity: 0.35; filter: drop-shadow(0 0 2px rgba(124,92,252,0.2)); }
        }
        .vf-splash-text {
          display: inline-flex;
          overflow: hidden;
          max-width: 0;
          animation: vf-grow 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards;
        }
        @keyframes vf-grow { to { max-width: 260px; } }
        .vf-letter {
          display: inline-block;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.01em;
          opacity: 0;
          transform: translateY(10px);
          animation: vf-letter-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .vf-letter-vibe { color: #f5f5f7; }
        .vf-letter-forge {
          background: linear-gradient(135deg, #7c5cfc, #a78bfa);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        @keyframes vf-letter-in {
          to { opacity: 1; transform: translateY(0); }
        }
        .vf-splash-bar-track {
          position: relative; width: 220px; height: 4px;
          border-radius: 999px; background: #1b1b23; overflow: hidden;
          animation: vf-bar-flash 1.4s ease-in-out infinite;
        }
        .vf-splash-bar-fill {
          position: absolute; top: 0; left: -40%; height: 100%; width: 40%;
          border-radius: 999px;
          background: linear-gradient(90deg, transparent, #a78bfa, #7c5cfc, transparent);
          animation: vf-scan 1.4s ease-in-out infinite;
        }
        @keyframes vf-scan { 0% { left: -40%; } 100% { left: 100%; } }
        @keyframes vf-bar-flash {
          0%, 100% { box-shadow: 0 0 0 rgba(124,92,252,0); }
          50% { box-shadow: 0 0 18px rgba(124,92,252,0.45); }
        }
        .vf-splash-label {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          font-size: 12px; color: #6b7280; letter-spacing: 0.02em;
        }
      `}</style>
      <div className="vf-splash-lockup">
        <VibeForgeLogo size={56} className="vf-splash-logo" />
        <span className="vf-splash-text">
          {WORD.split("").map((ch, i) => (
            <span
              key={i}
              className={`vf-letter ${i < VIBE_LEN ? "vf-letter-vibe" : "vf-letter-forge"}`}
              style={{ animationDelay: `${0.4 + i * 0.05}s` }}
            >
              {ch}
            </span>
          ))}
        </span>
      </div>
      <div className="vf-splash-bar-track"><div className="vf-splash-bar-fill" /></div>
      <div className="vf-splash-label">{label}</div>
    </div>
  );
}