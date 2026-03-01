export type Options = {
  title: string;
  body?: string;
  id?: number;
  group?: string;
  actionTypeId?: string;
  sound?: string;
  autoCancel?: boolean;
  extra?: Record<string, unknown>;
};

export async function isPermissionGranted(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  return Notification.permission === "granted";
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  return Notification.requestPermission();
}

export async function sendNotification(options: Options): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  new Notification(options.title, { body: options.body ?? "" });
}
