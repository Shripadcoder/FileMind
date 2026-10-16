export async function getHealth(): Promise<{ status: string; service?: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return res.json();
}

export async function getReady(): Promise<{ status: string; database?: string }> {
  const res = await fetch("/api/ready");
  if (!res.ok) throw new Error(`readiness check failed: ${res.status}`);
  return res.json();
}
