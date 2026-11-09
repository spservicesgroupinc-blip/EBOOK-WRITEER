// Server-only. Fetch fixed public API hosts; never follow URLs from search results.
import { SourceType, type Source } from '../types';

export async function retrieveResearch(topic: string, fetcher: typeof fetch = fetch): Promise<{ sources: Source[]; warnings: string[] }> {
  if (typeof topic !== 'string' || !topic.trim() || topic.trim().length > 200) {
    throw new Error('Enter a research topic of 1 to 200 characters.');
  }
  const query = topic.trim();
  const getJson = async (url: URL) => {
    const response = await fetcher(url.toString(), {
      headers: { 'User-Agent': 'EbookAI/1.0 (educational nonfiction research)', Accept: 'application/json' },
      signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Wikipedia research is unavailable (HTTP ${response.status}). Please retry.`);
    const data = await response.json();
    if (data?.error) throw new Error('Wikipedia could not complete this research request. Please retry.');
    return data;
  };
  const searchUrl = new URL('https://en.wikipedia.org/w/rest.php/v1/search/page');
  searchUrl.search = new URLSearchParams({ q: query, limit: '4' }).toString();
  const search = await getJson(searchUrl);
  const ids: number[] = [...new Set<number>((Array.isArray(search.pages) ? search.pages : [])
    .map((page: any) => page.id).filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0))].slice(0, 4);
  const retrievedAt = new Date().toISOString();
  const results = await Promise.allSettled(ids.map(async id => {
    const pageUrl = new URL('https://en.wikipedia.org/w/api.php');
    pageUrl.search = new URLSearchParams({ action: 'query', pageids: String(id), prop: 'extracts|revisions',
      explaintext: '1', rvprop: 'ids|timestamp', format: 'json', formatversion: '2' }).toString();
    const data = await getJson(pageUrl);
    const page = data.query?.pages?.[0];
    if (typeof page?.extract !== 'string' || page.extract.trim().length < 100 || typeof page.title !== 'string') {
      throw new Error('A matching page had no usable text.');
    }
    const revision = page.revisions?.[0];
    const url = Number.isSafeInteger(revision?.revid)
      ? `https://en.wikipedia.org/w/index.php?oldid=${revision.revid}`
      : `https://en.wikipedia.org/?curid=${id}`;
    const source: Source = {
      id: `research-wikipedia-${id}`, type: SourceType.TEXT, name: `Wikipedia: ${page.title}`,
      content: `Background reference excerpt, not primary-source verification. Wikipedia contributors; CC BY-SA. Paraphrase and attribute. Only the excerpt below was retrieved; do not imply the entire page or its bibliography was reviewed.\n\n${page.extract.slice(0, 14000)}`,
      isProcessing: false,
      research: { url, retrievedAt, revisionDate: typeof revision?.timestamp === 'string' ? revision.timestamp : undefined, query },
    };
    return source;
  }));
  const sources = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (!sources.length) throw new Error('No readable research sources were found. Try a simpler topic or add factual notes and turn off automatic research.');
  const failed = results.filter(result => result.status === 'rejected').length;
  return { sources, warnings: failed ? [`${failed} matching page(s) could not be retrieved; research coverage is incomplete.`] : [] };
}
