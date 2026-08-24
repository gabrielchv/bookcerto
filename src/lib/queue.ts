import { Queue, Worker, type Job } from "bullmq";
import { redis } from "@/lib/redis";

export function queue(name: string) {
  return new Queue(name, { connection: redis });
}
export function worker(name: string, handler: (job: Job) => Promise<void>) {
  return new Worker(name, handler, { connection: redis });
}
