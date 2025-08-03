/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `businesses` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `businessName` to the `businesses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `password` to the `businesses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "businessName" TEXT NOT NULL,
ADD COLUMN     "password" TEXT NOT NULL,
ALTER COLUMN "instagramUsername" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "businesses_email_key" ON "businesses"("email");
