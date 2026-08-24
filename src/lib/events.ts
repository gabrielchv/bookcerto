import { redis } from "@/lib/redis";

export const appointmentsChannel = (tenantId: string) =>
  `tenant:${tenantId}:appointments`;

export type AppointmentEvent = { id: string; event: string };

export async function publishEvent(tenantId: string, event: AppointmentEvent) {
  await redis.publish(appointmentsChannel(tenantId), JSON.stringify(event));
}
