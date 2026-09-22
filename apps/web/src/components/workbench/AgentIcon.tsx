export function AgentIcon({
  value,
  fallback = "🤖",
  alt = "",
  className = "h-full w-full object-cover",
}: {
  value?: string;
  fallback?: string;
  alt?: string;
  className?: string;
}) {
  const icon = value?.trim() || fallback;
  if (/^(https?:\/\/|\/|data:image\/|blob:)/i.test(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt={alt} loading="lazy" decoding="async" className={className} />;
  }
  return <>{icon}</>;
}
