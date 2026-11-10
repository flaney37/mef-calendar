CREATE TYPE "public"."mail_outcome" AS ENUM('processed', 'ignored', 'unsure');--> statement-breakpoint
CREATE TABLE "ingested_mails" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"volunteer_id" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"subject" text,
	"outcome" "mail_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingested_mails_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "volunteers_student_id_unique" UNIQUE("student_id"),
	CONSTRAINT "volunteers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "course_events" ADD COLUMN "mail_id" integer;--> statement-breakpoint
ALTER TABLE "ingested_mails" ADD CONSTRAINT "ingested_mails_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_events" ADD CONSTRAINT "course_events_mail_id_ingested_mails_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."ingested_mails"("id") ON DELETE set null ON UPDATE no action;