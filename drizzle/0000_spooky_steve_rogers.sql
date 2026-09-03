CREATE TABLE "calls" (
	"sid" text PRIMARY KEY NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"status" text NOT NULL,
	"dial_status" text,
	"accepted" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"talk_seconds" integer,
	"total_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"phone" text PRIMARY KEY NOT NULL,
	"name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"sid" text PRIMARY KEY NOT NULL,
	"from_number" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forwarded_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"forwarding_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voicemails" (
	"recording_sid" text PRIMARY KEY NOT NULL,
	"call_sid" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"transcript" text,
	"transcription_status" text DEFAULT 'pending' NOT NULL,
	"transcription_error" text,
	"notified_at" timestamp with time zone,
	"listened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voicemails_call_sid_unique" UNIQUE("call_sid")
);
--> statement-breakpoint
ALTER TABLE "voicemails" ADD CONSTRAINT "voicemails_call_sid_calls_sid_fk" FOREIGN KEY ("call_sid") REFERENCES "public"."calls"("sid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_from_idx" ON "calls" USING btree ("from_number");--> statement-breakpoint
CREATE INDEX "calls_started_idx" ON "calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "messages_from_idx" ON "messages" USING btree ("from_number");--> statement-breakpoint
CREATE INDEX "messages_received_idx" ON "messages" USING btree ("received_at");