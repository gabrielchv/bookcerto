ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_no_overlap";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, tstzrange("start_at", "end_at") WITH &&)
  WHERE ("status" = 'booked');
