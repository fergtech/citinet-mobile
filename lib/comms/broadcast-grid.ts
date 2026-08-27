// Box-size rules from the design brief (1 box fills the canvas, 2 stack as
// full-width rows, 3+ tile 2-across) — the brief's `calc(50% - 3px)` is a
// literal CSS value from a web prototype; RN's flexbox `gap` (supported
// since RN 0.71, this app is on 0.81) already reserves that same 6px
// gutter, so a plain 48% here (not 50%) is what actually avoids overflow.
// 5+ participants aren't called out in the brief — they fall back to the
// same 2-across tier and just wrap into more rows.
export type BroadcastGridBox = {
  widthPercent: number;
  heightPercent: number;
  avatarSize: number;
};

export function getBroadcastGridBox(participantCount: number): BroadcastGridBox {
  if (participantCount <= 1) return { widthPercent: 100, heightPercent: 100, avatarSize: 104 };
  if (participantCount === 2) return { widthPercent: 100, heightPercent: 48, avatarSize: 78 };
  return { widthPercent: 48, heightPercent: 48, avatarSize: 56 };
}
