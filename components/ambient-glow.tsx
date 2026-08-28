import { useEffect } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Three soft, drifting glows meant to sit on top of whatever background is
// already there (the caller's own themed surface — this component has no
// backdrop of its own, unlike the first pass) — not an obvious animation,
// more "something back there feels alive." Deliberately not particles/
// blobs/neon: each orb is a single radial-gradient circle fading to fully
// transparent (objectBoundingBox gradient units, so the fade stays correct
// as the circle's own radius "breathes"). A glass scrim on top (rendered by
// the caller, not here — see app/modal.tsx) diffuses the glow the rest of
// the way, like light through smoked glass.
type Orb = {
  color: string;
  cx: [number, number]; // drift range, 0-100 viewBox units
  cy: [number, number];
  r: [number, number]; // breathing range
  opacity: [number, number];
  moveDuration: number; // ms, one-way — full cycle is 2x this (there and back)
  breatheDuration: number;
  delay: number;
};

// cy values are the original layout shifted up by a flat 20 units (each
// pair keeps its original spread/delta, so the breathing/drift motion is
// unchanged) — the goal is the cluster sitting a bit higher as a whole, not
// a redesign of the composition itself. (A -40 shift pushed the whole
// cluster past the visible crop entirely, -10 was close but asked for a
// touch more — 20 is the middle of that range.) Everything else (r,
// opacity, durations, delays) is untouched on purpose.
//
// cx ranges were widened afterward — the trio only drifted within the
// middle ~24-72 of the 0-100 viewBox, leaving both edges of the (full-
// width) canvas empty, which read as narrower than the modal itself.
// Pushed each orb's drift range further toward its own edge so the glow
// reaches nearer both sides.
const ORBS: Orb[] = [
  // Amber — largest.
  { color: '#ff9f43', cx: [6, 46], cy: [0, 20], r: [34, 42], opacity: [0.2, 0.36], moveDuration: 5000, breatheDuration: 3500, delay: 0 },
  // Violet — medium, opposite drift direction.
  { color: '#8b5cf6', cx: [94, 54], cy: [12, 28], r: [28, 35], opacity: [0.18, 0.32], moveDuration: 6500, breatheDuration: 4000, delay: 500 },
  // Deep ember red — smallest, quickest pulse.
  { color: '#ef4444', cx: [30, 80], cy: [36, 14], r: [22, 28], opacity: [0.19, 0.34], moveDuration: 4500, breatheDuration: 3000, delay: 250 },
];

function useOrbAnimatedProps(orb: Orb) {
  const cx = useSharedValue(orb.cx[0]);
  const cy = useSharedValue(orb.cy[0]);
  const r = useSharedValue(orb.r[0]);
  const opacity = useSharedValue(orb.opacity[0]);

  useEffect(() => {
    const ease = Easing.inOut(Easing.sin);
    cx.value = withDelay(orb.delay, withRepeat(withTiming(orb.cx[1], { duration: orb.moveDuration, easing: ease }), -1, true));
    cy.value = withDelay(orb.delay, withRepeat(withTiming(orb.cy[1], { duration: orb.moveDuration, easing: ease }), -1, true));
    r.value = withDelay(orb.delay, withRepeat(withTiming(orb.r[1], { duration: orb.breatheDuration, easing: ease }), -1, true));
    opacity.value = withDelay(orb.delay, withRepeat(withTiming(orb.opacity[1], { duration: orb.breatheDuration, easing: ease }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedProps(() => ({
    cx: cx.value,
    cy: cy.value,
    r: r.value,
    opacity: opacity.value,
  }));
}

function GlowOrb({ orb, index }: { orb: Orb; index: number }) {
  const animatedProps = useOrbAnimatedProps(orb);
  return (
    <AnimatedCircle
      cx={orb.cx[0]}
      cy={orb.cy[0]}
      r={orb.r[0]}
      fill={`url(#glow-${index})`}
      animatedProps={animatedProps}
    />
  );
}

export function AmbientGlow({ style, ...rest }: ViewProps) {
  return (
    <View style={[styles.fill, style]} {...rest}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {ORBS.map((orb, index) => (
            <RadialGradient key={index} id={`glow-${index}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={orb.color} stopOpacity={1} />
              <Stop offset="100%" stopColor={orb.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {ORBS.map((orb, index) => (
          <GlowOrb key={index} orb={orb} index={index} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
