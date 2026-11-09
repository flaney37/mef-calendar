CREATE TYPE "public"."event_source" AS ENUM('manual', 'mail');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('confirmed', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('cancel', 'makeup', 'room_change', 'exam', 'other');--> statement-breakpoint
CREATE TABLE "course_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"semester_id" integer NOT NULL,
	"course_code" text NOT NULL,
	"section" text,
	"type" "event_type" NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"room" text,
	"title" text,
	"note" text,
	"status" "event_status" DEFAULT 'confirmed' NOT NULL,
	"source" "event_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"student_id" integer NOT NULL,
	"course_code" text NOT NULL,
	"section" text NOT NULL,
	CONSTRAINT "enrollments_student_id_course_code_pk" PRIMARY KEY("student_id","course_code")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"semester_id" integer NOT NULL,
	"course_code" text NOT NULL,
	"section" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	CONSTRAINT "meetings_weekday_check" CHECK ("meetings"."weekday" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"holidays" date[] DEFAULT '{}'::date[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_token" text NOT NULL,
	"edit_token" text NOT NULL,
	"semester_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_feed_token_unique" UNIQUE("feed_token"),
	CONSTRAINT "students_edit_token_unique" UNIQUE("edit_token")
);
--> statement-breakpoint
ALTER TABLE "course_events" ADD CONSTRAINT "course_events_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_events_course_idx" ON "course_events" USING btree ("semester_id","course_code");--> statement-breakpoint
CREATE INDEX "meetings_section_idx" ON "meetings" USING btree ("semester_id","course_code","section");