/*
  Warnings:

  - You are about to drop the column `igUsername` on the `businesses` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[instagramUsername]` on the table `businesses` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "businesses_igUsername_key";

-- AlterTable
ALTER TABLE "businesses" DROP COLUMN "igUsername",
ADD COLUMN     "facebookAccessToken" TEXT,
ADD COLUMN     "facebookVerifyToken" TEXT,
ADD COLUMN     "instagramPassword" TEXT,
ADD COLUMN     "instagramUsername" TEXT,
ADD COLUMN     "whatsappBearerToken" TEXT,
ADD COLUMN     "whatsappVerifyToken" TEXT;

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '30 days';

-- CreateIndex
CREATE UNIQUE INDEX "businesses_instagramUsername_key" ON "businesses"("instagramUsername");
