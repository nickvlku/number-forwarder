CREATE TABLE "greeting" (
	"id" integer PRIMARY KEY NOT NULL,
	"audio" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
