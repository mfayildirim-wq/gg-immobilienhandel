CREATE TABLE "fach"."makler_anlaesse" (
	"makler_id" text PRIMARY KEY NOT NULL,
	"ermittelt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anlaesse" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."makler_anlaesse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fach"."makler_anlaesse" ADD CONSTRAINT "makler_anlaesse_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE cascade ON UPDATE no action;