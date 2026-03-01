import type { EventBus } from "../events/eventBus.js";

type DictationSessionState = "idle" | "listening" | "processing";

export class DictationService {
  private state: DictationSessionState = "idle";

  constructor(private readonly eventBus: EventBus) {}

  async requestPermission(): Promise<boolean> {
    return true;
  }

  async start(preferredLanguage: string | null): Promise<void> {
    void preferredLanguage;
    this.state = "listening";
    this.emitState();
  }

  async stop(): Promise<void> {
    if (this.state !== "listening") {
      this.state = "idle";
      this.emitState();
      return;
    }
    this.state = "processing";
    this.emitState();
    this.state = "idle";
    this.emitState();
  }

  async cancel(): Promise<void> {
    this.state = "idle";
    this.eventBus.publish("dictation-event", {
      type: "canceled",
      message: "Dictation canceled.",
    });
    this.emitState();
  }

  private emitState(): void {
    this.eventBus.publish("dictation-event", {
      type: "state",
      state: this.state,
    });
  }
}
