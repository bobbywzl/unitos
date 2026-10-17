import nspell from "nspell";
import type { SpellReply, SpellRequest } from "@/components/proofing/spell-service";
import { SPELL_SAMPLE } from "@/lib/spell-words";

// The spelling check off the page's thread (SPEC.md §29, typing): nspell
// with the English Hunspell dictionary (public/spelling), built here once on
// the first request, so building it and checking a long document never
// holds up typing.

// The worker's own scope, typed by what it uses (the project's types are the page's).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SpellRequest>) => void) | null;
  postMessage: (reply: SpellReply) => void;
};

const text = (url: string) => fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error(url))));
let checker: Promise<ReturnType<typeof nspell> | null> | null = null;
const load = () =>
  (checker ??= Promise.all([text("/spelling/en.aff"), text("/spelling/en.dic")])
    .then(([aff, dic]) => nspell(aff, dic))
    .catch(() => {
      checker = null;
      return null;
    }));

scope.onmessage = async (e: MessageEvent<SpellRequest>) => {
  const request = e.data;
  const spell = await load();
  let reply: SpellReply;
  if (!spell) reply = { id: request.id, failed: true };
  else if (request.kind === "suggest") reply = { id: request.id, suggestions: spell.suggest(request.word) };
  else {
    reply = {
      id: request.id,
      results: request.paragraphs.map((words) => {
        const bad: number[] = [];
        let known = 0;
        words.forEach((word, i) => {
          if (spell.correct(word)) {
            if (i < SPELL_SAMPLE) known++;
          } else bad.push(i);
        });
        return { bad, known };
      }),
    };
  }
  scope.postMessage(reply);
};
