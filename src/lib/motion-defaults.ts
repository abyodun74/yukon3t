// The app-wide default transition for every motion animation that doesn't set its own (MotionProvider passes it to
// the root MotionConfig). Motion's own default for x/y/scale/rotate is an underdamped spring, so without this any
// `animate=`, `exit=`, variant or layout animation someone forgets to give a `transition` would bounce. This is a
// plain ease-out tween: every control point of the curve is within 0..1, so it never passes its target.
//
// Verified in motion 14's source: MotionConfig puts `transition` on MotionConfigContext (a nested MotionConfig keeps
// the parent's unless it sets its own); every motion component spreads that context under its own props
// (framer-motion motion/index.mjs `configAndProps`) into its VisualElement; VisualElement.getDefaultTransition()
// returns props.transition; animateTarget (motion-dom visual-element-target.mjs) uses it whenever the animation
// target carries no transition of its own; and animateMotionValue only falls back to the per-value spring
// (getDefaultTransition in default-transitions.mjs) when that resolved transition defines nothing.
// Guarded by src/components/motion-defaults.test.ts.
export const APP_DEFAULT_TRANSITION = {
  type: "tween",
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
} as const;
