"use client";

import { useEffect, type ReactNode } from "react";

// The trial band's offer as a link (signin/trial-band.tsx): a click jumps to
// the sign-up email field (emailId, set in signin/page.tsx) and focuses it.
// On the sign-up card the page scrolls there, smooth unless reduced motion
// is on. Anywhere else (sign in, forgot password, check your email) the link
// opens /signin#<emailId>, and the effect below centers the field and
// focuses it once the sign-up card has loaded. With email sign-up off there is no field, and the
// link opens /signin, where the card is.

function emailField(id: string): HTMLInputElement | null {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el : null;
}

export function JumpToEmail({
  emailId,
  className,
  children,
}: {
  emailId: string;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (window.location.hash !== `#${emailId}`) return;
    const field = emailField(emailId);
    if (!field) return;
    // The browser's own jump to the hash puts the field at the top edge;
    // center it instead.
    field.scrollIntoView({ block: "center" });
    field.focus({ preventScroll: true });
  }, [emailId]);

  return (
    <a
      href={`/signin#${emailId}`}
      className={className}
      onClick={(e) => {
        const field = emailField(emailId);
        if (!field) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        field.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        field.focus({ preventScroll: true });
      }}
    >
      {children}
    </a>
  );
}
