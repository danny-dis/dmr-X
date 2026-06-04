const base = (props) => {
    const { size = 24, ...rest } = props;
    return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest };
};
export function BrandMark({ size = 28, ...props }) {
    return (<svg width={size} height={size} viewBox="0 0 32 32" fill="none" {...props}>
      <defs>
        <linearGradient id="dmrx-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C5CFF"/>
          <stop offset="100%" stopColor="#22D3EE"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0F1118"/>
      <path d="M8 7 L8 25 M8 16 L24 7 M8 16 L24 25" stroke="url(#dmrx-g)" strokeWidth="2.4" strokeLinecap="round"/>
      <circle cx="8" cy="7" r="1.8" fill="#7C5CFF"/>
      <circle cx="8" cy="25" r="1.8" fill="#7C5CFF"/>
      <circle cx="24" cy="7" r="1.8" fill="#22D3EE"/>
      <circle cx="24" cy="25" r="1.8" fill="#22D3EE"/>
      <circle cx="8" cy="16" r="1.4" fill="#E6E8F0"/>
    </svg>);
}
export function BrandWordmark({ height = 22, ...props }) {
    return (<svg height={height} viewBox="0 0 130 32" fill="none" {...props}>
      <defs>
        <linearGradient id="dmrx-w" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C5CFF"/>
          <stop offset="100%" stopColor="#22D3EE"/>
        </linearGradient>
      </defs>
      <path d="M8 7 L8 25 M8 16 L24 7 M8 16 L24 25" stroke="url(#dmrx-w)" strokeWidth="2.4" strokeLinecap="round"/>
      <circle cx="8" cy="7" r="1.8" fill="#7C5CFF"/>
      <circle cx="8" cy="25" r="1.8" fill="#7C5CFF"/>
      <circle cx="24" cy="7" r="1.8" fill="#22D3EE"/>
      <circle cx="24" cy="25" r="1.8" fill="#22D3EE"/>
      <text x="34" y="22" fontFamily="Inter" fontWeight="800" fontSize="16" letterSpacing="-0.3" fill="currentColor">DMR-X</text>
    </svg>);
}
export function OverviewIcon(props) {
    return (<svg {...base(props)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      <path d="M3 11.5h7M11.5 3v7M14 7h7M17.5 3v7M14 14l7 7M14 21h7" strokeOpacity="0.5"/>
    </svg>);
}
export function PlaygroundIcon(props) {
    return (<svg {...base(props)}>
      <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5v-3.5h-.5A1.5 1.5 0 0 1 4 15.5v-9z"/>
      <path d="M8.5 9.5h7M8.5 12h4" strokeOpacity="0.6"/>
    </svg>);
}
export function RequestsIcon(props) {
    return (<svg {...base(props)}>
      <path d="M3 12h2l2-6 4 12 2-9 2 6h6"/>
    </svg>);
}
export function RoutingIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="5" cy="6" r="2"/>
      <circle cx="5" cy="18" r="2"/>
      <circle cx="19" cy="12" r="2"/>
      <path d="M7 6h4a4 4 0 0 1 4 4v0M7 18h4a4 4 0 0 0 4-4v0"/>
      <path d="M15 12h2"/>
    </svg>);
}
export function QuotaIcon(props) {
    return (<svg {...base(props)}>
      <path d="M12 3a9 9 0 1 0 9 9"/>
      <path d="M12 12L19 6"/>
      <path d="M16 3h3v3"/>
    </svg>);
}
export function ProvidersIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="5" r="2"/>
      <circle cx="5" cy="19" r="2"/>
      <circle cx="19" cy="19" r="2"/>
      <path d="M12 7v4M12 11l-7 6M12 11l7 6"/>
    </svg>);
}
export function ModelsIcon(props) {
    return (<svg {...base(props)}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/>
      <path d="M12 12l8-4.5M12 12l-8-4.5M12 12v9"/>
    </svg>);
}
export function TenantsIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="9" cy="8" r="3"/>
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
      <circle cx="17" cy="6" r="2.2"/>
      <path d="M14 13.2c0.9-1.4 2.4-2.2 4-2.2 2.8 0 5 2.2 5 5"/>
    </svg>);
}
export function PoliciesIcon(props) {
    return (<svg {...base(props)}>
      <path d="M12 3l8 3v5c0 5-3.4 9-8 10-4.6-1-8-5-8-10V6l8-3z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>);
}
export function UsageIcon(props) {
    return (<svg {...base(props)}>
      <path d="M3 17l5-5 4 4 8-8"/>
      <path d="M14 8h6v6"/>
      <path d="M3 21h18"/>
    </svg>);
}
export function BenchmarksIcon(props) {
    return (<svg {...base(props)}>
      <path d="M8 21V8M12 21V4M16 21v-7M20 21v-4"/>
      <path d="M4 21h17"/>
      <path d="M6 6l1.5-2L9 6M11 3l1.5-2L14 3"/>
    </svg>);
}
export function MemoryIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="12" r="3"/>
      <circle cx="4" cy="6" r="1.5"/>
      <circle cx="20" cy="6" r="1.5"/>
      <circle cx="4" cy="18" r="1.5"/>
      <circle cx="20" cy="18" r="1.5"/>
      <circle cx="12" cy="4" r="1.5"/>
      <circle cx="12" cy="20" r="1.5"/>
      <path d="M5.2 7l5 3.5M18.8 7l-5 3.5M5.2 17l5-3.5M18.8 17l-5-3.5M12 5.5v4.5M12 14.5v4"/>
    </svg>);
}
export function SandboxIcon(props) {
    return (<svg {...base(props)}>
      <rect x="3" y="8" width="18" height="13" rx="1.5"/>
      <path d="M3 12h18"/>
      <path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/>
      <circle cx="8" cy="16" r="0.5" fill="currentColor"/>
    </svg>);
}
export function WorkersIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="4" r="1.5"/>
      <circle cx="5" cy="11" r="1.5"/>
      <circle cx="19" cy="11" r="1.5"/>
      <circle cx="8" cy="19" r="1.5"/>
      <circle cx="16" cy="19" r="1.5"/>
      <path d="M12 5.5L7 9.5M12 5.5l5 4M8 12l-1 5.5M16 12l1 5.5"/>
    </svg>);
}
export function FederationIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>
      <circle cx="3" cy="12" r="1.2" fill="currentColor"/>
      <circle cx="21" cy="12" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="3" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="21" r="1.2" fill="currentColor"/>
    </svg>);
}
export function FreeTierIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M8 12h8M12 8v8" strokeLinecap="round"/>
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" strokeLinecap="round" strokeOpacity="0.5" strokeWidth="1.2"/>
    </svg>);
}
export function ObservabilityIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="11" cy="11" r="6"/>
      <path d="M15.5 15.5L20 20"/>
      <circle cx="11" cy="11" r="2" fill="currentColor" stroke="none"/>
    </svg>);
}
export function AuditIcon(props) {
    return (<svg {...base(props)}>
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M8 8h8M8 12h8M8 16h5"/>
      <circle cx="18" cy="6" r="2.5" fill="currentColor" stroke="none" opacity="0.4"/>
    </svg>);
}
export function TelemetryIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="12" r="2"/>
      <path d="M5 12a7 7 0 0 1 14 0M2 12a10 10 0 0 1 20 0"/>
      <path d="M8 12a4 4 0 0 1 8 0"/>
    </svg>);
}
export function AlertsIcon(props) {
    return (<svg {...base(props)}>
      <path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2H4.5L6 17z"/>
      <path d="M10 21a2 2 0 0 0 4 0"/>
      <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none"/>
    </svg>);
}
export function SettingsIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
    </svg>);
}
export const SidebarIcons = {
    OverviewIcon,
    PlaygroundIcon,
    RequestsIcon,
    RoutingIcon,
    QuotaIcon,
    ProvidersIcon,
    FreeTierIcon,
    ModelsIcon,
    TenantsIcon,
    PoliciesIcon,
    UsageIcon,
    BenchmarksIcon,
    MemoryIcon,
    SandboxIcon,
    WorkersIcon,
    FederationIcon,
    ObservabilityIcon,
    AuditIcon,
    TelemetryIcon,
    AlertsIcon,
    SettingsIcon,
};
//# sourceMappingURL=SidebarIcons.js.map