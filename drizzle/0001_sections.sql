CREATE TABLE "sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"semester_id" integer NOT NULL,
	"course_code" text NOT NULL,
	"section" text NOT NULL,
	"course_name" text,
	"instructor" text
);
--> statement-breakpoint
DROP INDEX "meetings_section_idx";--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sections_key_idx" ON "sections" USING btree ("semester_id","course_code","section");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_slot_idx" ON "meetings" USING btree ("semester_id","course_code","section","weekday","start_time");