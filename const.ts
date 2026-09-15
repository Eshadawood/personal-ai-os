export function startLogin() {
  const portal = import.meta.env.VITE_OAUTH_PORTAL_URL;
  if (portal) window.location.href = portal;
  else window.location.href = "/api/oauth/login";
}
