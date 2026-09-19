ALTER TABLE "fach"."merge_protokoll" ADD COLUMN "ergebnis_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "fach"."merge_protokoll" ADD COLUMN "betroffene_dateien" jsonb;--> statement-breakpoint
ALTER TABLE "fach"."merge_protokoll" ADD COLUMN "rueckgaengig_am" timestamp with time zone;