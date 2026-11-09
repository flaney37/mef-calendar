CREATE TYPE "public"."section_source" AS ENUM('catalog', 'student');--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "source" "section_source" DEFAULT 'student' NOT NULL;