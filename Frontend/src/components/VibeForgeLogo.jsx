import React from "react";

export default function VibeForgeLogo({ size = 40, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="vfLogoGradient" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7c5cfc" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* broken ring — three arc segments */}
      <path d="M14 24a8 8 0 1 1 8 8" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M22 16a8 8 0 0 1 6.9 4" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M10.5 19a8 8 0 0 1 3-5.4" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      {/* diagonal slash through the ring */}
      <line x1="8" y1="30" x2="30" y2="8" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" />
      {/* spark accent above */}
      <line x1="20" y1="4" x2="20" y2="12" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="24" y1="6" x2="19" y2="13" stroke="url(#vfLogoGradient)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}