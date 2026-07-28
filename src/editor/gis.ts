/* Google Identity Services, loaded once.
   ---------------------------------------------------------------------------
   The JS-callback flow, not the redirect flow: Google hands the credential to
   a function of ours, which posts it with fetch. That is why there is no
   g_csrf_token anywhere in the editor — that cookie belongs to the form-POST
   flow.

   The promise is memoised. Signing out and back in re-renders the sign-in
   card, and without this each round trip would append another copy of
   Google's script to the head. */

export interface GisCredential {
  credential?: string;
}

export interface GisButtonOptions {
  type: "standard" | "icon";
  theme: "outline" | "filled_blue" | "filled_black";
  size: "small" | "medium" | "large";
  text: "signin_with" | "signup_with" | "continue_with" | "signin";
  /** Pixels. Google clamps this to 200–400 and defaults to about 200, which
      on a phone is a small button adrift in the middle of the screen. */
  width?: number;
}

interface Gis {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GisCredential) => void;
      }): void;
      renderButton(parent: HTMLElement, options: GisButtonOptions): void;
    };
  };
}

export const GIS_SRC = "https://accounts.google.com/gsi/client";

let pending: Promise<Gis> | null = null;

export function loadGis(src: string = GIS_SRC): Promise<Gis> {
  if (pending) return pending;
  pending = new Promise<Gis>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      const gis = (window as unknown as { google?: Gis }).google;
      if (gis) resolve(gis);
      else reject(new Error("Google's sign-in script loaded but exposed nothing"));
    };
    script.onerror = () => {
      /* A failed load must not poison the next attempt — the owner may just
         have been offline for a moment. */
      pending = null;
      reject(new Error("Google's sign-in script didn't load"));
    };
    document.head.append(script);
  });
  return pending;
}
