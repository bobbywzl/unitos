"use client";

import type { Person } from "@/lib/person";
import { useCollab } from "@/components/collab/collab-context";

// The round badge for one person: picture when set, else symbol on their
// color. Sized for chips (18px) and presence rows (26px).
export function PersonBadge({
  person,
  size = 18,
  title,
}: {
  person: Person;
  size?: number;
  title?: string;
}) {
  if (person.picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.picture}
        alt=""
        title={title ?? person.name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      title={title ?? person.name}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.52 }}
    >
      {person.symbol}
    </span>
  );
}

// The author label on a note, annotation, distillation, extraction, or edit:
// the author's badge plus name. Renders nothing on an unshared corpus, for an
// unknown author, or for content without one — solo work stays unlabeled.
export function AuthorChip({
  createdById,
  size = 15,
  nameless,
}: {
  createdById: string | null | undefined;
  size?: number;
  // Badge only, name in the title — for tight rows.
  nameless?: boolean;
}) {
  const { shared, people } = useCollab();
  if (!shared || !createdById) return null;
  const person = people[createdById];
  if (!person) return null;
  return (
    <span
      className="inline-flex max-w-40 items-center gap-1 text-[11px] text-sand-600"
      title={person.name}
    >
      <PersonBadge person={person} size={size} />
      {!nameless && <span className="truncate">{person.name}</span>}
    </span>
  );
}
