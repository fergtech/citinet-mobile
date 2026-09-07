import Svg, { Circle } from 'react-native-svg';

// Custom glyph for the public view/impression counter — deliberately not an
// eye (Instagram/Medium's icon for this) or ascending bars (X/Twitter's) —
// picked instead to echo this app's own icon language: components/ui/
// custom-icon.tsx's "citinetLogo" is built the same way, two concentric
// open arcs (via stroke-dasharray on a circle, not hand-authored path data)
// around a center point. Here that same construction reads as a signal
// pulsing outward from a point — a post's reach rippling out — rather than
// a brand ring. The two rings are rotated to different angles so their gaps
// don't line up, which is what keeps it reading as an irregular pulse
// instead of a single interrupted circle.
export function ImpressionsIcon({ size = 16, color }: { size?: number; color: string }) {
  const cx = 12;
  const cy = 12;

  // 300° arc / 60° gap for both rings, via strokeDasharray = [dash, gap] in
  // path-length units (circumference, not degrees) — round to keep the
  // numbers legible rather than passing full float precision.
  const arcDash = (r: number) => {
    const circumference = 2 * Math.PI * r;
    const dash = (circumference * 300) / 360;
    const gap = circumference - dash;
    return `${dash.toFixed(2)} ${gap.toFixed(2)}`;
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={cx} cy={cy} r={1.8} fill={color} />
      <Circle
        cx={cx}
        cy={cy}
        r={6}
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={arcDash(6)}
        rotation={-40}
        origin={`${cx}, ${cy}`}
      />
      <Circle
        cx={cx}
        cy={cy}
        r={10}
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={arcDash(10)}
        rotation={160}
        origin={`${cx}, ${cy}`}
      />
    </Svg>
  );
}
