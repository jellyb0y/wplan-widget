// Нативные уведомления macOS.
import { Notification } from 'electron';

export function notify(opts: {
  title: string;
  body: string;
  onClick?: () => void;
  silent?: boolean;
}): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: opts.title,
    body: opts.body,
    silent: opts.silent ?? false,
  });
  if (opts.onClick) n.on('click', opts.onClick);
  n.show();
}
