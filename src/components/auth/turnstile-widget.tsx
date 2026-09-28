'use client';

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: (errorCode?: string) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onloadTurnstileCallback?: () => void;
    onTurnstileSuccess?: (token: string) => void;
    onTurnstileExpired?: () => void;
    onTurnstileError?: (err?: string) => void;
  }
}

interface TurnstileWidgetProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onError?: (err?: string) => void;
  onExpire?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

export function TurnstileWidget({
  siteKey = '0x4AAAAAAFHPovaqcaTd365Y',
  onVerify,
  onError,
  onExpire,
  theme = 'auto',
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const key = siteKey || '0x4AAAAAAFHPovaqcaTd365Y';
    if (!key) return;

    // Setup global handlers
    window.onTurnstileSuccess = (token: string) => {
      onVerify(token);
    };
    window.onTurnstileExpired = () => {
      if (onExpire) onExpire();
    };
    window.onTurnstileError = (err?: string) => {
      if (onError) onError(err);
    };

    const renderWidget = () => {
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;
      try {
        containerRef.current.innerHTML = '';
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: key,
          callback: (token: string) => {
            onVerify(token);
          },
          'error-callback': (errorCode?: string) => {
            if (onError) onError(errorCode);
          },
          'expired-callback': () => {
            if (onExpire) onExpire();
          },
          theme,
          size: 'normal',
        });
        setRendered(true);
      } catch (err) {
        console.error('[Turnstile Render Error]', err);
      }
    };

    window.onloadTurnstileCallback = renderWidget;

    // Load Turnstile script if not present
    const existing = document.getElementById('cf-turnstile-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.turnstile) {
      renderWidget();
    }

    // Safety fallback interval in case script loads before callback binds
    const timer = setInterval(() => {
      if (window.turnstile && !widgetIdRef.current) {
        renderWidget();
      }
    }, 400);

    return () => {
      clearInterval(timer);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        } catch (_) {}
      }
    };
  }, [siteKey, onVerify, onError, onExpire, theme]);

  const key = siteKey || '0x4AAAAAAFHPovaqcaTd365Y';

  return (
    <div className="flex flex-col justify-center items-center my-3 w-full min-h-[70px]">
      <div
        ref={containerRef}
        id="cf-turnstile-container"
        className="overflow-hidden rounded-xl flex justify-center items-center"
      />
      {!rendered && (
        <div className="text-[11px] text-muted-foreground animate-pulse py-2">
          Memuat verifikasi Cloudflare...
        </div>
      )}
    </div>
  );
}
