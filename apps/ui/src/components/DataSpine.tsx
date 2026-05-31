import { useMemo } from 'react';

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export default function DataSpine() {
  const dots = useMemo(() =>
    Array.from({ length: 20 }).map((_, i) => ({
      width: 2 + seededRandom(i * 7 + 1) * 4,
      left: seededRandom(i * 7 + 2) * 100,
      top: seededRandom(i * 7 + 3) * 100,
      color: seededRandom(i * 7 + 4) > 0.5 ? '#F7A51C' : '#00E0FF',
      duration: 2 + seededRandom(i * 7 + 5) * 3,
      delay: seededRandom(i * 7 + 6) * 2,
    })), []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Animated gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(247, 165, 28, 0.15), transparent),
            radial-gradient(ellipse 60% 40% at 80% 50%, rgba(0, 224, 255, 0.08), transparent),
            radial-gradient(ellipse 50% 30% at 20% 80%, rgba(247, 165, 28, 0.06), transparent)
          `,
        }}
      />
      {/* Animated dots */}
      <div className="absolute inset-0" style={{ opacity: 0.3 }}>
        {dots.map((dot, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${dot.width}px`,
              height: `${dot.width}px`,
              left: `${dot.left}%`,
              top: `${dot.top}%`,
              backgroundColor: dot.color,
              animation: `pulse-ring ${dot.duration}s ease-in-out infinite`,
              animationDelay: `${dot.delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
