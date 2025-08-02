-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "facebookPageAccessToken" TEXT,
ADD COLUMN     "facebookVerifyToken" TEXT,
ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "whatsappBearerToken" TEXT,
ADD COLUMN     "whatsappVerifyToken" TEXT;

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';
