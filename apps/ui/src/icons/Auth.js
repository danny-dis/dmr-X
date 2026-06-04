const base = (props) => {
    const { size = 24, ...rest } = props;
    return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest };
};
export function ApiKeyIcon(props) {
    return (<svg {...base(props)}>
      <circle cx="8" cy="12" r="3.5"/>
      <path d="M11.5 12H21M17 8l3 4-3 4"/>
    </svg>);
}
export function OAuthIcon(props) {
    return (<svg {...base(props)}>
      <path d="M12 4l4 4-4 4M12 4l-4 4 4 4"/>
      <path d="M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/>
    </svg>);
}
export function PKCEIcon(props) {
    return (<svg {...base(props)}>
      <rect x="3" y="8" width="18" height="12" rx="2"/>
      <path d="M7 8V6a5 5 0 0 1 10 0v2"/>
      <circle cx="12" cy="14" r="1.5" fill="currentColor"/>
    </svg>);
}
export function DeviceCodeIcon(props) {
    return (<svg {...base(props)}>
      <rect x="6" y="2" width="12" height="20" rx="2"/>
      <path d="M9 6h6M10 18h4"/>
      <rect x="8" y="9" width="8" height="6" rx="0.5"/>
    </svg>);
}
export function ClientCredentialsIcon(props) {
    return (<svg {...base(props)}>
      <rect x="3" y="6" width="18" height="12" rx="1.5"/>
      <path d="M8 10h.01M8 14h8"/>
    </svg>);
}
export const AuthIcons = {
    api_key: ApiKeyIcon,
    oauth: OAuthIcon,
    pkce: PKCEIcon,
    device_code: DeviceCodeIcon,
    client_credentials: ClientCredentialsIcon,
};
//# sourceMappingURL=Auth.js.map