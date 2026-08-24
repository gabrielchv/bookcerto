import { worker } from "@/lib/queue";
import { LogProvider } from "@/lib/reminders";

const provider = new LogProvider();

worker("reminders", async (job) => {
  await provider.send({
    to: "client@example.com",
    subject: "Lembrete",
    body: `Appointment ${job.data.appointmentId}`,
  });
});

console.log("worker started");
