/* The POST envelope.
   ---------------------------------------------------------------------------
   What the widget sends and how it sends it. The handler on the other side
   is createFeedbackHandler from @shaahink/sitekit/feedback. */

import type { TargetContext } from "./context.js";

export interface PageInfo {
  url: string;
  path: string;
  title: string;
  lang: string;
}

export interface ClientInfo {
  viewport: string;
  dpr: number;
  ua: string;
}

export interface FeedbackPayload {
  key: string;
  website: string;
  comment: string;
  name: string;
  image: string | null;
  page: PageInfo;
  target: TargetContext;
  client: ClientInfo;
}

export function pageInfo(): PageInfo {
  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    lang: document.documentElement.lang || ""
  };
}

export function clientInfo(): ClientInfo {
  return {
    viewport: window.innerWidth + "×" + window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    ua: navigator.userAgent
  };
}

export interface PayloadInput {
  key: string;
  comment: string;
  target: TargetContext;
  /** The honeypot field's value — sent verbatim so bots defeat themselves. */
  website?: string;
  name?: string;
  image?: string | null;
}

export function buildPayload(input: PayloadInput): FeedbackPayload {
  return {
    key: input.key,
    website: input.website || "",
    comment: input.comment,
    name: input.name || "",
    image: input.image || null,
    page: pageInfo(),
    target: input.target,
    client: clientInfo()
  };
}

/** POST the payload. Resolves with the handler's response body; rejects with
    an Error whose message is the handler's own wording where there is one. */
export function postFeedback(endpoint: string, payload: FeedbackPayload): Promise<any> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data: any) {
      if (!response.ok || !data.ok) throw new Error(data.error || ("HTTP " + response.status));
      return data;
    });
  });
}
