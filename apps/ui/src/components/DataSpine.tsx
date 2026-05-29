export default function DataSpine() {
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
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${2 + Math.random() * 4}px`,
              height: `${2 + Math.random() * 4}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              backgroundColor: Math.random() > 0.5 ? '#F7A51C' : '#00E0FF',
              animation: `pulse-ring ${2 + Math.random() * 3}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
