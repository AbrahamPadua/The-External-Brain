import React, { useId, useEffect, useState } from 'react';

export const NeuralBackground: React.FC = () => {
  const id = useId();
  const [isPaused, setIsPaused] = useState(() => document.hidden);

  useEffect(() => {
    const handleVisibility = () => setIsPaused(document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div
      className={`neural-background ${isPaused ? 'is-paused' : ''}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1440 1024"
        preserveAspectRatio="xMidYMid slice"
        className="neural-background-art"
      >
        <defs>
          <linearGradient id={`${id}-axon-cyan`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#007381" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${id}-axon-crimson`} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FF3B5C" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#930028" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#FF3B5C" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${id}-synapse-cross`} x1="0%" y1="0%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#F43F5E" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF3B5C" stopOpacity="0.35" />
          </linearGradient>
          <radialGradient id={`${id}-soma-cyan`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E0FFFF" />
            <stop offset="35%" stopColor="#00E5FF" />
            <stop offset="75%" stopColor="#007381" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-soma-crimson`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFE4E8" />
            <stop offset="35%" stopColor="#FF3B5C" />
            <stop offset="75%" stopColor="#A5002A" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FF3B5C" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g fill="none" strokeLinecap="round" opacity="0.45">
          <path d="M -50,180 C 140,210 220,120 380,240 S 520,380 690,320 S 910,210 1100,290 S 1320,180 1520,230" stroke="#00E5FF" strokeWidth="1.8" opacity="0.6" />
          <path d="M 380,240 C 440,160 510,90 620,110 S 760,190 880,140 S 1060,90 1210,130 S 1390,70 1500,90" stroke="#00E5FF" strokeWidth="1.0" opacity="0.5" />
          <path d="M 380,240 C 310,340 280,480 340,620 S 480,740 560,860 S 680,950 820,990" stroke="#00E5FF" strokeWidth="1.2" opacity="0.55" />
          <path d="M 1480,520 C 1320,490 1200,600 1040,540 S 880,410 740,490 S 530,640 370,590 S 160,700 -20,670" stroke="#FF3B5C" strokeWidth="1.6" opacity="0.55" />
          <path d="M 1040,540 C 980,660 930,790 990,910 S 1120,980 1260,1050" stroke="#FF3B5C" strokeWidth="1.1" opacity="0.4" />
          <path d="M 740,490 C 710,610 650,710 680,820 S 770,920 860,1010" stroke="#FF3B5C" strokeWidth="0.9" opacity="0.45" />
          <path d="M 220,120 C 270,60 340,30 420,50 S 530,40 600,10" stroke="#00E5FF" strokeWidth="0.75" opacity="0.35" />
          <path d="M 690,320 C 730,390 770,430 840,460 S 960,450 1020,490" stroke="#38BDF8" strokeWidth="0.8" opacity="0.4" />
          <path d="M 910,210 C 940,150 990,120 1080,100 S 1210,60 1310,40" stroke="#00E5FF" strokeWidth="0.8" opacity="0.3" />
          <path d="M 1200,600 C 1240,680 1290,750 1370,810 S 1460,880 1520,930" stroke="#FF3B5C" strokeWidth="0.9" opacity="0.35" />
          <path d="M 530,640 C 490,720 440,790 380,850 S 260,920 180,980" stroke="#FF3B5C" strokeWidth="0.8" opacity="0.35" />
          <path d="M 380,240 Q 560,460 740,490" stroke={`url(#${id}-synapse-cross)`} strokeWidth="1.5" strokeDasharray="4 6" opacity="0.5" />
          <path d="M 690,320 Q 860,430 1040,540" stroke={`url(#${id}-synapse-cross)`} strokeWidth="1.5" strokeDasharray="5 7" opacity="0.6" />
          <path d="M 560,860 Q 650,680 740,490" stroke={`url(#${id}-synapse-cross)`} strokeWidth="1.2" strokeDasharray="3 5" opacity="0.45" />
          <path d="M 1100,290 Q 1070,410 1040,540" stroke="#00E5FF" strokeWidth="1.1" strokeDasharray="4 8" opacity="0.4" />
        </g>

        <g fill="none" strokeLinecap="round">
          <path className="axon-stream" d="M -50,180 C 140,210 220,120 380,240 S 520,380 690,320 S 910,210 1100,290 S 1320,180 1520,230" stroke="#00E5FF" strokeWidth="1.5" opacity="0.45" />
          <path className="axon-stream" d="M 380,240 C 310,340 280,480 340,620 S 480,740 560,860 S 680,950 820,990" stroke="#38BDF8" strokeWidth="1.2" opacity="0.4" />
          <path className="axon-stream-rev" d="M 1480,520 C 1320,490 1200,600 1040,540 S 880,410 740,490 S 530,640 370,590 S 160,700 -20,670" stroke="#FF3B5C" strokeWidth="1.5" opacity="0.45" />
          <path className="axon-stream" d="M 1040,540 C 980,660 930,790 990,910 S 1120,980 1260,1050" stroke="#F43F5E" strokeWidth="1.2" opacity="0.35" />
          <path className="axon-stream" d="M 380,240 Q 560,460 740,490" stroke="#00E5FF" strokeWidth="1.3" opacity="0.4" />
          <path className="axon-stream" d="M 690,320 Q 860,430 1040,540" stroke="#FF3B5C" strokeWidth="1.3" opacity="0.4" />
        </g>

        <g className="soma-pulse">
          <g>
            <circle cx="380" cy="240" r="32" fill={`url(#${id}-soma-cyan)`} opacity="0.25" />
            <circle cx="380" cy="240" r="8" fill="#00E5FF" stroke="#E0FFFF" strokeWidth="2" />
            <circle cx="380" cy="240" r="3.5" fill="#FFFFFF" />
          </g>
          <g>
            <circle cx="690" cy="320" r="36" fill={`url(#${id}-soma-cyan)`} opacity="0.3" />
            <circle cx="690" cy="320" r="9" fill="#00E5FF" stroke="#E0FFFF" strokeWidth="2" />
            <circle cx="690" cy="320" r="3.5" fill="#FFFFFF" />
          </g>
          <g>
            <circle cx="1040" cy="540" r="42" fill={`url(#${id}-soma-crimson)`} opacity="0.32" />
            <circle cx="1040" cy="540" r="10" fill="#FF3B5C" stroke="#FFE4E8" strokeWidth="2" />
            <circle cx="1040" cy="540" r="4" fill="#FFFFFF" />
          </g>
          <g>
            <circle cx="740" cy="490" r="30" fill={`url(#${id}-soma-crimson)`} opacity="0.25" />
            <circle cx="740" cy="490" r="7.5" fill="#FF3B5C" stroke="#FFE4E8" strokeWidth="1.8" />
            <circle cx="740" cy="490" r="3" fill="#FFFFFF" />
          </g>
          <g>
            <circle cx="1100" cy="290" r="28" fill={`url(#${id}-soma-cyan)`} opacity="0.25" />
            <circle cx="1100" cy="290" r="6" fill="#00E5FF" stroke="#E0FFFF" strokeWidth="1.5" />
            <circle cx="1100" cy="290" r="2.5" fill="#FFFFFF" />
          </g>
          <g>
            <circle cx="560" cy="860" r="28" fill={`url(#${id}-soma-cyan)`} opacity="0.25" />
            <circle cx="560" cy="860" r="6.5" fill="#00E5FF" stroke="#E0FFFF" strokeWidth="1.5" />
            <circle cx="560" cy="860" r="2.5" fill="#FFFFFF" />
          </g>
        </g>

        <g>
          <circle cx="220" cy="120" r="4.5" fill="#00E5FF" opacity="0.75" />
          <circle cx="910" cy="210" r="4.5" fill="#00E5FF" opacity="0.75" />
          <circle cx="1200" cy="600" r="4" fill="#FF3B5C" opacity="0.75" />
          <circle cx="370" cy="590" r="4.5" fill="#FF3B5C" opacity="0.75" />
          <circle cx="880" cy="140" r="3.5" fill="#00E5FF" opacity="0.6" />
          <circle cx="990" cy="910" r="4" fill="#FF3B5C" opacity="0.7" />
          <circle cx="340" cy="620" r="3.5" fill="#00E5FF" opacity="0.6" />
          <circle cx="1320" cy="180" r="4" fill="#00E5FF" opacity="0.65" />
          <circle cx="1260" cy="1050" r="4.5" fill="#FF3B5C" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
};

export default NeuralBackground;
