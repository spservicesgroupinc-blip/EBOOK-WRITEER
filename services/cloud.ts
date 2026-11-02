
import { BookProject, User } from "../types";

// --- CONFIGURATION ---
// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL INSIDE THE QUOTES BELOW:
export const BACKEND_URL: string = "https://script.google.com/macros/s/AKfycbzJwd1gkhh3g65Pttx6tijjFzjPbjMkzopFRWMUQlvzilzQj-fvPOrgNVnCdzFA8RKW/exec"; 
// Example: "https://script.google.com/macros/s/AKfycbx.../exec"
// ---------------------

async function postToAppsScript(url: string, payload: Record<string, any>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Unexpected response from Google Apps Script. Make sure the Web App is deployed with 'Who has access: Anyone'.");
  }
}

const EBOOKAI_USER_PREFIX = "ebookai_";
const EBOOKAI_PROJECT_PREFIX = "ebookai_";

function toScopedUsername(username: string): string {
  const clean = username.trim();
  return clean.startsWith(EBOOKAI_USER_PREFIX) ? clean : `${EBOOKAI_USER_PREFIX}${clean}`;
}

function fromScopedUsername(scopedUsername: string): string {
  return String(scopedUsername || '').replace(/^ebookai_/, '');
}

export const CloudService = {
  
  async login(url: string, username: string, password: string): Promise<User> {
    const targetUrl = url || BACKEND_URL;
    if (!targetUrl) throw new Error("Backend URL is missing.");

    const scopedUsername = toScopedUsername(username);
    const data = await postToAppsScript(targetUrl, {
      action: 'login',
      username: scopedUsername,
      password,
      appNamespace: 'ebook-ai',
    });
    if (data.status === 'error') throw new Error(data.message);
    
    return {
      username: fromScopedUsername(data.username || username),
      folderId: data.folderId,
      backendUrl: targetUrl
    };
  },

  async signup(url: string, username: string, password: string): Promise<User> {
    const targetUrl = url || BACKEND_URL;
    if (!targetUrl) throw new Error("Backend URL is missing.");

    const scopedUsername = toScopedUsername(username);
    const data = await postToAppsScript(targetUrl, {
      action: 'signup',
      username: scopedUsername,
      password,
      appNamespace: 'ebook-ai',
    });
    if (data.status === 'error') throw new Error(data.message);

    return {
      username: fromScopedUsername(data.username || username),
      folderId: data.folderId,
      backendUrl: targetUrl
    };
  },

  async syncUp(user: User, project: BookProject): Promise<void> {
    const targetUrl = BACKEND_URL || user.backendUrl;
    const scopedProject = {
      ...project,
      id: project.id.startsWith(EBOOKAI_PROJECT_PREFIX)
        ? project.id
        : `${EBOOKAI_PROJECT_PREFIX}${project.id}`,
      appNamespace: 'ebook-ai',
    };
    const data = await postToAppsScript(targetUrl, { 
      action: 'syncUp', 
      folderId: user.folderId, 
      project: scopedProject,
      appNamespace: 'ebook-ai',
    });
    if (data.status === 'error') throw new Error(data.message);
  },

  async syncDown(user: User): Promise<BookProject[]> {
    const targetUrl = BACKEND_URL || user.backendUrl;
    const data = await postToAppsScript(targetUrl, { 
      action: 'syncDown', 
      folderId: user.folderId,
      appNamespace: 'ebook-ai',
    });
    if (data.status === 'error') throw new Error(data.message);
    
    const rawProjects: any[] = data.projects || [];
    return rawProjects
      .filter((p) => p && (p.appNamespace === 'ebook-ai' || String(p.id || '').startsWith(EBOOKAI_PROJECT_PREFIX)))
      .map((p) => ({
        ...p,
        id: String(p.id || '').replace(/^ebookai_/, ''),
      }));
  },

  async exportToDoc(user: User, title: string, description: string, chapters: any[]): Promise<string> {
    const targetUrl = BACKEND_URL || user.backendUrl;
    const data = await postToAppsScript(targetUrl, {
      action: 'exportDoc',
      folderId: user.folderId,
      title,
      description,
      chapters,
      appNamespace: 'ebook-ai',
    });
    if (data.status === 'error') throw new Error(data.message);
    return data.url;
  }
};

