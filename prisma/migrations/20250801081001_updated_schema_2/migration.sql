-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "lastPolledAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';
