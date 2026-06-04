const base = (props) => {
    const { size = 24, ...rest } = props;
    return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest };
};
export function ProviderMark({ size = 20, ...props }) {
    return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <defs>
        <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.5"/>
        </linearGradient>
      </defs>
      <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" stroke="url(#pm-g)" strokeWidth="1.4"/>
      <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
      <circle cx="12" cy="6" r="0.8" fill="currentColor"/>
      <circle cx="12" cy="18" r="0.8" fill="currentColor"/>
      <circle cx="6.5" cy="9" r="0.8" fill="currentColor"/>
      <circle cx="17.5" cy="9" r="0.8" fill="currentColor"/>
      <circle cx="6.5" cy="15" r="0.8" fill="currentColor"/>
      <circle cx="17.5" cy="15" r="0.8" fill="currentColor"/>
    </svg>);
}
export function ProviderHub({ size = 24, ...props }) {
    return (<svg {...base(props)}>
      <rect x="9" y="9" width="6" height="6" rx="1"/>
      <path d="M12 9V4M12 20v-5M9 12H4M20 12h-5"/>
      <circle cx="12" cy="3" r="1"/>
      <circle cx="12" cy="21" r="1"/>
      <circle cx="3" cy="12" r="1"/>
      <circle cx="21" cy="12" r="1"/>
    </svg>);
}
export function CloudProvider({ size = 24, ...props }) {
    return (<svg {...base(props)}>
      <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 7.96"/>
      <path d="M12 12v4M10 14l2 2 2-2"/>
    </svg>);
}
export function LocalProvider({ size = 24, ...props }) {
    return (<svg {...base(props)}>
      <rect x="3" y="4" width="18" height="12" rx="1.5"/>
      <path d="M9 20h6M12 16v4"/>
      <path d="M7 8h2M7 11h4" strokeOpacity="0.5"/>
    </svg>);
}
//# sourceMappingURL=Provider.js.map