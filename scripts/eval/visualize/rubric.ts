// What a valuable visualization is (SPEC.md §20, §25): the criteria the judge
// scores 1 to 5, written as questions a reader would ask of the picture. A
// decline is scored on `decision` alone; the picture criteria are null for it.
export const VIZ_CRITERIA: { key: string; ask: string }[] = [
  {
    key: "decision",
    ask: "Was drawing, or declining, the right call? A passage whose idea has drawable structure — a process, a law of change, a mechanism, named parts and their relations, quantities compared — should be drawn. A passage of opinion, of narrative without structure, or of a claim whose whole content is its words should be declined. A decline scores 5 only when its reason names what was tried and why it fails.",
  },
  {
    key: "accuracy",
    ask: "Is every element, label, number, and relation in the picture stated in the passage or elsewhere in the article, or the analogy's own and mapped to something stated? Nothing invented, nothing wrong, no relation drawn that the text does not make, no number off.",
  },
  {
    key: "core_idea",
    ask: "Does the picture carry the passage's core idea as it sits in the article — what the passage adds to what the article set up — with every key part present, and not a side point? When the passage answers or replaces something stated earlier, does the picture show both?",
  },
  {
    key: "glance",
    ask: "Would a reader who has not read the passage get the point within five seconds: one clear focal point, an obvious reading order, the passage's own part standing out, a caption that states the point?",
  },
  {
    key: "legibility",
    ask: "At 320 px wide, as shown: is every label readable, nothing overlapping, nothing cut off or outside the frame, no crowding, colors from one consistent palette?",
  },
  {
    key: "kind_fit",
    ask: "Is the kind the best one for this passage: a law of change as a simulation, an ordered process as an animation or a sequence diagram, named parts and relations as a diagram, quantities compared as a chart-like picture, a physical arrangement or a shape as a picture?",
  },
];

export const PICTURE_KEYS = ["accuracy", "core_idea", "glance", "legibility", "kind_fit"];
