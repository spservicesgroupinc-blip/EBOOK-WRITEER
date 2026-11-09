/** Gateways and crashed serverless functions can return text/HTML instead of JSON. */
export async function readApiJson(response: Response, context: string): Promise<Record<string, any>> {
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { /* Report protocol errors below, without displaying raw markup. */ }
  const isObject = data !== null && typeof data === 'object' && !Array.isArray(data);
  if (!response.ok || (isObject && data.error)) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
    if (typeof message === 'string' && message.trim()) {
      throw new Error(`${context}: ${message.slice(0, 600)} (HTTP ${response.status}).`);
    }
    if (response.status === 504 || response.status === 408) {
      throw new Error(`${context} timed out (HTTP ${response.status}). Please retry shortly.`);
    }
    if (response.status === 429) {
      throw new Error(`${context} is rate-limited (HTTP 429). Wait a moment, then retry.`);
    }
    throw new Error(`${context} is unavailable (HTTP ${response.status}). Please retry shortly.`);
  }
  if (!isObject) throw new Error(`${context} returned an invalid response (HTTP ${response.status}). Please reload and retry.`);
  return data;
}
