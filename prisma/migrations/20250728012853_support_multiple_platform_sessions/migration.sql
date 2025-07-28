/*
  Warnings:

  - A unique constraint covering the columns `[businessId,platform]` on the table `sessions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `platform` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- DropIndex
DROP INDEX "sessions_businessId_key";

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "platform" "Platform" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sessions_businessId_platform_key" ON "sessions"("businessId", "platform");
