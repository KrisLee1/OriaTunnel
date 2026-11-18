import type { Task } from "./api";

export type FileSide = "local" | "remote";
type SessionFor = (
  hostId: string,
  savedId: string,
  side: FileSide,
  reconnect: boolean,
) => Promise<string | undefined>;

export async function recoverTransfer(
  task: Task,
  action: "resume" | "verify",
  sessionFor: SessionFor,
  control: (
    id: string,
    action: string,
    session: string,
    source?: string,
  ) => Promise<unknown>,
) {
  const primary = task.targetRemote ?? task.sourceRemote ?? task;
  for (const reconnect of [false, true]) {
    const session = await sessionFor(
      primary.hostId,
      primary.sessionId,
      "remote",
      reconnect,
    );
    if (!session) return;
    let source: string | undefined;
    if (task.direction === "relay" && task.sourceRemote) {
      source = await sessionFor(
        task.sourceRemote.hostId,
        task.sourceRemote.sessionId,
        "local",
        reconnect,
      );
      if (!source) return;
    }
    try {
      if (
        action === "resume" &&
        task.temp &&
        !task.directPending &&
        task.error !== "commitUnknown"
      )
        await control(task.id, "cleanup", session, source);
      await control(task.id, action, session, source);
      return;
    } catch (error) {
      // A transport can close between selecting a connected session and the
      // backend checking its route. Reconnect only on an explicit recovery action.
      if (
        reconnect ||
        !/^(?:notConnected|session closed|sender dropped)$/i.test(String(error))
      )
        throw error;
    }
  }
}
