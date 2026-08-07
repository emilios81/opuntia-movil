import React from 'react';

export function OpuntiaLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 100 110" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* Suelo/Base */}
      <path 
        d="M25 100C35 98 65 98 75 100" 
        stroke="currentColor" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
      />
      
      {/* Cactus Opuntia (Estructura de Cruz según imagen) */}
      <path 
        d="M50 100V35 M50 35C50 25 58 15 65 25C72 35 65 45 50 35 M50 35V100 M50 65H25C15 65 15 50 25 50C35 50 45 58 50 65 M50 65H75C85 65 85 50 75 50C65 50 55 58 50 65" 
        stroke="currentColor" 
        strokeWidth="7" 
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sol (Posicionado arriba a la izquierda como en la imagen) */}
      <g className="text-accent">
        <circle cx="35" cy="25" r="6" fill="currentColor" />
        {/* Rayos del sol */}
        <line x1="35" y1="14" x2="35" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="35" y1="33" x2="35" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="24" y1="25" x2="27" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="43" y1="25" x2="46" y2="25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="27" y1="17" x2="30" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="30" x2="43" y2="33" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="27" y1="33" x2="30" y2="30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="20" x2="43" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
