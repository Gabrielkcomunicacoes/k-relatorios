import React from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function Logo({ className = '', size = 'md' }: LogoProps) {
  const sizeClasses = {
    sm: 'h-6',
    md: 'h-9',
    lg: 'h-12',
    xl: 'h-16',
  };

  return (
    <svg
      id="brand_logo_svg"
      viewBox="0 0 152 48"
      className={`${sizeClasses[size]} ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* "K" Icon shapes */}
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {/* Top-left triangle */}
        <polygon points="2,2 23,2 2,23" />
        {/* Bottom-left triangle */}
        <polygon points="2,46 2,25 23,46" />
        {/* Right triangle pointing left */}
        <polygon points="9,24 35,5 35,43" />
      </g>

      {/* "REL." Text shapes */}
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {/* R */}
        <path d="M 56,42 V 6 H 71 C 77,6 77,22 71,22 H 56 M 68,22 L 78,42" />
        {/* E */}
        <path d="M 106,6 H 88 V 42 H 106 M 88,24 H 102" />
        {/* L */}
        <path d="M 116,6 V 42 H 134" />
        {/* Circle dot */}
        <circle cx="144" cy="40" r="2" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
