-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" DROP NOT NULL,
ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';
