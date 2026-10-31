// Loaded on demand by MotionProvider (src/components/motion-provider.tsx), never imported statically: this is the
// bulk of motion (animations, exit, gestures, drag, layout), kept out of the root layout chunk every route ships.
// domMax rather than domAnimation because Sheet's bottom sheet uses drag-to-dismiss.
import { domMax } from "motion/react";

export default domMax;
