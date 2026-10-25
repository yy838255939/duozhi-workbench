// Preserve call-site compatibility without sending usage to upstream analytics.
export function trackEvent(_name: string, _props?: Record<string, string | number | boolean | undefined>) {}
