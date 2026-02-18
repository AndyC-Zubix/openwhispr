// Status indicator component for Javas plugin
// Displays the current state of the voice agent

export const JAVAS_STATES = {
  idle: { label: "Idle", color: "gray" },
  listening: { label: "Listening", color: "green" },
  capturing: { label: "Capturing", color: "yellow" },
  processing: { label: "Processing", color: "blue" },
} as const;

export type JavasState = keyof typeof JAVAS_STATES;

export function getStateDisplay(state: string) {
  return JAVAS_STATES[state as JavasState] || JAVAS_STATES.idle;
}

export default { JAVAS_STATES, getStateDisplay };
