export function shouldDropSubscription(status: number): boolean {
  return status === 404 || status === 410;
}

/** Push URLs are navigation only. They never authorize a request. */
export function notificationPath(data: { url?: unknown }): string {
  return typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//")
    ? data.url
    : "/";
}
