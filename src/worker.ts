import http from "node:http";
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

const port = Number(process.env.PORT) || 8080;
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  })
  .listen(port);

console.log(`worker started on :${port}`);
