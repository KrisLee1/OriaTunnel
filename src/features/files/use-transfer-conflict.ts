import { useEffect, useReducer } from "react";
import type { Task } from "./api";

export const conflictKey = (task: Task) =>
  JSON.stringify([task.id, task.conflict, task.conflictSource, task.error]);

export type ConflictState = { current: string | null; dismissed: string[] };
type ConflictAction =
  | { type: "sync"; tasks: Task[] }
  | { type: "open"; key: string }
  | { type: "dismiss"; key: string };

export function conflictReducer(
  state: ConflictState,
  action: ConflictAction,
): ConflictState {
  if (action.type === "open")
    return {
      current: action.key,
      dismissed: state.dismissed.filter((key) => key !== action.key),
    };
  if (action.type === "dismiss")
    return {
      current: state.current === action.key ? null : state.current,
      dismissed: state.dismissed.includes(action.key)
        ? state.dismissed
        : [...state.dismissed, action.key],
    };
  const keys = action.tasks
    .filter((task) => task.phase === "conflict")
    .map(conflictKey);
  const dismissed = state.dismissed.filter((key) => keys.includes(key));
  const current =
    state.current && keys.includes(state.current)
      ? state.current
      : keys.find((key) => !dismissed.includes(key)) || null;
  return current === state.current &&
    dismissed.length === state.dismissed.length
    ? state
    : { current, dismissed };
}

export function useTransferConflict(tasks: Task[]) {
  const [state, dispatch] = useReducer(conflictReducer, {
    current: null,
    dismissed: [],
  });
  useEffect(() => {
    dispatch({ type: "sync", tasks });
  }, [tasks, state.current, state.dismissed]);
  return {
    task: tasks.find(
      (task) =>
        task.phase === "conflict" && conflictKey(task) === state.current,
    ),
    show: (task: Task) => dispatch({ type: "open", key: conflictKey(task) }),
    dismiss: (task: Task) =>
      dispatch({ type: "dismiss", key: conflictKey(task) }),
  };
}
