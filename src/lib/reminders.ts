import { queue } from "@/lib/queue";

export interface ReminderProvider {
  send(due: { to: string; subject: string; body: string }): Promise<void>;
}

export class LogProvider implements ReminderProvider {
  async send(due: { to: string; subject: string; body: string }) {
    console.log(`[reminder] to=${due.to} subject=${due.subject}`);
  }
}

export async function scheduleReminder(appointmentId: string, tenantId: string, dueAt: Date) {
  const q = queue("reminders");
  const delay = dueAt.getTime() - Date.now();
  await q.add("send", { appointmentId, tenantId }, { delay: Math.max(delay, 0) });
}
